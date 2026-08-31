import type { WebSocket } from "ws";
import type { Db } from "mongodb";
import { roomManager } from "../rooms/roomManager.js";
import { Room, LOBBY_DURATION_MS, RECONNECT_WINDOW_MS, CHAT_RATE_LIMIT } from "../rooms/room.js";
import { parseClientMessage } from "./protocol.js";
import { rollDice } from "../game/dice.js";
import { canRequestMove, canRollDice, playerHasNoLegalMoves } from "../game/validation.js";
import { applyMove, skipTurn } from "../game/movement.js";
import { isTripleSix } from "../game/rules.js";
import { RateLimiter } from "../util/rateLimit.js";
import { recordMatchResult } from "../db/matches.js";

interface ConnMeta {
  roomCode: string | null;
  playerId: string | null;
}

const connMeta = new WeakMap<WebSocket, ConnMeta>();
const chatLimiter = new RateLimiter(CHAT_RATE_LIMIT.limit, CHAT_RATE_LIMIT.windowMs);
const HEARTBEAT_INTERVAL_MS = 5_000;

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/**
 * `fatal: true` means the client's current room/session is unusable and it's fair to
 * show a full-page error (room gone, full, etc). Everything else (a mistimed
 * dice/move request from a double-click, chat rate limiting) is a normal, expected
 * race that should be surfaced as a small transient notice, never a page-blocking error.
 */
function sendError(ws: WebSocket, code: string, message: string, fatal = false) {
  send(ws, { type: "error", code, message, fatal });
}

function broadcast(room: Room, payload: unknown, exceptPlayerId?: string) {
  for (const player of room.players.values()) {
    if (exceptPlayerId && player.id === exceptPlayerId) continue;
    if (player.ws) send(player.ws, payload);
  }
}

function broadcastRoomState(room: Room) {
  broadcast(room, { type: "room:state", room: room.toLobbyState() });
}

function broadcastGameState(room: Room, lastMove?: unknown) {
  broadcast(room, { type: "game:state", ...room.toGameStatePayload(), lastMove: lastMove ?? null });
}

function sanitizeChatText(raw: string): string {
  // Strip HTML tags/links per spec: no links, no HTML.
  const noTags = raw.replace(/<[^>]*>/g, "");
  const noLinks = noTags.replace(/\bhttps?:\/\/\S+/gi, "[link removed]").replace(/\bwww\.\S+/gi, "[link removed]");
  return noLinks.trim().slice(0, 150);
}

export function handleConnection(ws: WebSocket, getDb: () => Promise<Db | null>) {
  connMeta.set(ws, { roomCode: null, playerId: null });

  // Section 7: the client must receive a real readiness handshake, not just an HTTP 200.
  send(ws, { type: "engine:ready", serverTime: Date.now() });

  const heartbeat = setInterval(() => {
    if (ws.readyState === ws.OPEN) send(ws, { type: "ping", t: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("message", (raw: Buffer) => {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return sendError(ws, "bad_json", "Malformed message");
    }
    const msg = parseClientMessage(json);
    if (!msg) return sendError(ws, "bad_message", "Invalid message");

    const meta = connMeta.get(ws)!;

    switch (msg.type) {
      case "room:create": {
        const room = roomManager.createRoom(msg.maxPlayers);
        room.transition("READY");
        const player = room.addPlayer({ name: msg.name, isGuest: msg.isGuest, userId: msg.userId ?? null });
        room.creatorId = player.id;
        player.ws = ws;
        connMeta.set(ws, { roomCode: room.code, playerId: player.id });
        room.startLobby();
        send(ws, {
          type: "room:created",
          code: room.code,
          playerId: player.id,
          playerToken: player.id,
          room: room.toLobbyState(),
        });
        scheduleLobbyClose(room);
        break;
      }

      case "room:join": {
        const room = roomManager.get(msg.code);
        if (!room) return sendError(ws, "room_not_found", "Room not found", true);
        if (room.status === "EXPIRED" || room.status === "FINISHED") {
          return sendError(ws, "room_closed", "Room is no longer available", true);
        }

        // Reconnect path: same player rejoining with their token.
        if (msg.playerToken && room.players.has(msg.playerToken)) {
          const player = room.reconnectPlayer(msg.playerToken, ws)!;
          connMeta.set(ws, { roomCode: room.code, playerId: player.id });
          send(ws, { type: "room:joined", playerId: player.id, playerToken: player.id, room: room.toLobbyState() });
          if (room.status === "PLAYING" && room.game) {
            send(ws, { type: "game:state", ...room.toGameStatePayload(), lastMove: null });
          }
          broadcast(room, { type: "player:reconnected", playerId: player.id }, player.id);
          broadcastRoomState(room);
          return;
        }

        if (room.status !== "LOBBY" || room.isFull()) {
          return sendError(ws, "room_unavailable", "Room is full or already started", true);
        }

        const player = room.addPlayer({ name: msg.name, isGuest: msg.isGuest, userId: msg.userId ?? null });
        player.ws = ws;
        connMeta.set(ws, { roomCode: room.code, playerId: player.id });
        send(ws, { type: "room:joined", playerId: player.id, playerToken: player.id, room: room.toLobbyState() });
        broadcastRoomState(room);
        break;
      }

      case "room:start_now": {
        const room = meta.roomCode ? roomManager.get(meta.roomCode) : undefined;
        if (!room || !meta.playerId) return;
        if (!room.isHost(meta.playerId)) {
          return sendError(ws, "not_host", "Only the room creator can start the game early");
        }
        if (room.status !== "LOBBY") return;
        if (room.joinedCount < 2) {
          return sendError(ws, "not_enough_players", "Need at least 2 players to start");
        }
        if (room.lobbyTimer) clearTimeout(room.lobbyTimer);
        closeLobbyNow(room);
        break;
      }

      case "room:leave": {
        if (!meta.roomCode || !meta.playerId) return;
        const room = roomManager.get(meta.roomCode);
        if (!room) return;
        if (room.status === "LOBBY" || room.status === "READY") {
          // Before the game starts, a leave just frees the seat entirely.
          room.players.delete(meta.playerId);
          room.joinOrder = room.joinOrder.filter((id) => id !== meta.playerId);
          broadcastRoomState(room);
        } else {
          room.markDisconnected(meta.playerId);
          broadcast(room, { type: "player:left", playerId: meta.playerId });
          broadcastRoomState(room);
        }
        connMeta.set(ws, { roomCode: null, playerId: null });
        break;
      }

      case "chat:send": {
        const room = meta.roomCode ? roomManager.get(meta.roomCode) : undefined;
        if (!room || !meta.playerId) return;
        if (!chatLimiter.allow(meta.playerId)) {
          return sendError(ws, "rate_limited", "You're sending messages too fast");
        }
        const player = room.players.get(meta.playerId);
        if (!player) return;
        const clean = sanitizeChatText(msg.text);
        if (!clean) return;
        const chatMsg = room.addChatMessage(player.id, player.name, clean);
        broadcast(room, { type: "chat:message", message: chatMsg });
        break;
      }

      case "dice:request": {
        const room = meta.roomCode ? roomManager.get(meta.roomCode) : undefined;
        if (!room || !room.game || !meta.playerId) return;
        if (!canRollDice(room.game, meta.playerId)) {
          // Very common with a fast double-click; never fatal.
          return sendError(ws, "not_your_turn", "It's not your turn to roll");
        }
        const dice = rollDice();
        const priorSixes = room.game.consecutiveSixes;
        room.game.currentDice = dice;
        room.game.diceRolledThisTurn = true;
        room.game.consecutiveSixes = dice === 6 ? priorSixes + 1 : 0;

        broadcast(room, { type: "dice:result", dice, playerId: meta.playerId });

        if (isTripleSix(priorSixes, dice)) {
          room.game.consecutiveSixes = 0;
          skipTurn(room.game);
          broadcastGameState(room);
        } else if (playerHasNoLegalMoves(room.game)) {
          skipTurn(room.game);
          broadcastGameState(room);
        }
        break;
      }

      case "move:request": {
        const room = meta.roomCode ? roomManager.get(meta.roomCode) : undefined;
        if (!room || !room.game || !meta.playerId) return;
        if (!canRequestMove(room.game, meta.playerId, msg.pieceId)) {
          return send(ws, { type: "move:result", ok: false, error: "illegal_move" });
        }
        const result = applyMove(room.game, msg.pieceId);
        send(ws, { type: "move:result", ok: result.ok, error: result.error, info: result.info });
        broadcastGameState(room, result.info);

        if (result.wonPlayerId) {
          room.finish(result.wonPlayerId);
          broadcast(room, { type: "game:finished", winnerId: result.wonPlayerId });
          getDb()
            .then((db) => recordMatchResult(db, room, result.wonPlayerId!))
            .catch(() => {});
          roomManager.scheduleCleanup(room.code);
        }
        break;
      }

      case "pong": {
        const room = meta.roomCode ? roomManager.get(meta.roomCode) : undefined;
        if (!room || !meta.playerId) return;
        const player = room.players.get(meta.playerId);
        if (!player) return;
        player.pingMs = Math.max(0, Date.now() - msg.t);
        player.lastSeen = Date.now();
        broadcast(room, { type: "player:ping", playerId: player.id, pingMs: player.pingMs });
        break;
      }
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    const meta = connMeta.get(ws);
    if (!meta?.roomCode || !meta.playerId) return;
    const room = roomManager.get(meta.roomCode);
    if (!room) return;
    room.markDisconnected(meta.playerId);
    broadcast(room, { type: "player:disconnected", playerId: meta.playerId });
    broadcastRoomState(room);

    // Give the player a short window to reconnect before treating this as a permanent leave.
    setTimeout(() => {
      const p = room.players.get(meta.playerId!);
      if (p && !p.connected) {
        broadcast(room, { type: "player:left", playerId: meta.playerId });
      }
    }, RECONNECT_WINDOW_MS);
  });
}

/** Shared by both the automatic 30s timer and a host's manual "start now". */
function closeLobbyNow(room: Room) {
  if (room.status !== "LOBBY") return;
  const started = room.lockAndStart();
  if (!started) {
    room.expire();
    broadcast(room, { type: "room:expired", reason: "not_enough_players" });
    roomManager.expireRoom(room.code);
    return;
  }
  broadcast(room, { type: "game:start", ...room.toGameStatePayload() });
}

function scheduleLobbyClose(room: Room) {
  room.lobbyTimer = setTimeout(() => closeLobbyNow(room), LOBBY_DURATION_MS);
}
