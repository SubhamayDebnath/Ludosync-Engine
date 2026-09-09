import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { GameState, RoomStatus } from "../game/types.js";
import { createInitialGameState } from "../game/state.js";
import { assertTransition } from "./stateMachine.js";

/**
 * How long an un-started room (READY/LOBBY, host hasn't hit Start) is allowed to sit idle
 * before it's auto-closed. Does NOT apply once a match is PLAYING — an in-progress game is
 * never force-killed by a flat timer.
 */
export const ROOM_AUTO_CLOSE_MS = Number(process.env.ROOM_AUTO_CLOSE_MS_OVERRIDE) || 10 * 60_000;
/** Grace period a disconnected in-match player has to reconnect before their seat is forfeited. */
export const RECONNECT_WINDOW_MS = Number(process.env.RECONNECT_WINDOW_MS_OVERRIDE) || 2 * 60_000;
export const CHAT_MAX_LEN = 150;
export const CHAT_RATE_LIMIT = { limit: 5, windowMs: 5_000 };

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  ts: number;
}

export interface RoomPlayer {
  id: string;
  ws: WebSocket | null;
  name: string;
  isGuest: boolean;
  userId: string | null;
  connected: boolean;
  lastSeen: number;
  disconnectedAt: number | null;
  pingMs: number | null;
  /** Pending forfeit timer while this player is disconnected mid-match; cleared on reconnect. */
  removalTimer: NodeJS.Timeout | null;
}

export class Room {
  readonly code: string;
  readonly maxPlayers: number;
  creatorId: string;
  status: RoomStatus = "CREATING";
  createdAt = Date.now();
  lobbyStartAt: number | null = null;
  /** When an un-started room will be auto-closed if the host hasn't hit Start by then. */
  autoCloseAt: number | null = null;
  players = new Map<string, RoomPlayer>();
  joinOrder: string[] = [];
  chat: ChatMessage[] = [];
  game: GameState | null = null;
  /** Fires ROOM_AUTO_CLOSE_MS after entering LOBBY; cleared once the host starts the match. */
  autoCloseTimer: NodeJS.Timeout | null = null;

  constructor(code: string, maxPlayers: number) {
    this.code = code;
    this.maxPlayers = maxPlayers;
    this.creatorId = ""; // set once the creator's player record is added
  }

  transition(to: RoomStatus) {
    assertTransition(this.status, to);
    this.status = to;
  }

  addPlayer(input: { name: string; isGuest: boolean; userId: string | null }): RoomPlayer {
    const id = randomUUID();
    const player: RoomPlayer = {
      id,
      ws: null,
      name: input.name.slice(0, 24),
      isGuest: input.isGuest,
      userId: input.userId,
      connected: true,
      lastSeen: Date.now(),
      disconnectedAt: null,
      pingMs: null,
      removalTimer: null,
    };
    this.players.set(id, player);
    this.joinOrder.push(id);
    return player;
  }

  reconnectPlayer(playerId: string, ws: WebSocket): RoomPlayer | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.ws = ws;
    player.connected = true;
    player.disconnectedAt = null;
    player.lastSeen = Date.now();
    this.cancelRemoval(playerId);
    // Keep the authoritative game copy of connection state in sync so opponents' UI reflects it.
    const gamePlayer = this.game?.players.find((p) => p.id === playerId);
    if (gamePlayer) gamePlayer.connected = true;
    return player;
  }

  markDisconnected(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.ws = null;
    player.disconnectedAt = Date.now();
    const gamePlayer = this.game?.players.find((p) => p.id === playerId);
    if (gamePlayer) gamePlayer.connected = false;
  }

  /** Schedules a permanent-forfeit callback if `playerId` is still disconnected after the grace window. */
  scheduleRemoval(playerId: string, onExpire: () => void) {
    const player = this.players.get(playerId);
    if (!player) return;
    this.cancelRemoval(playerId);
    player.removalTimer = setTimeout(onExpire, RECONNECT_WINDOW_MS);
  }

  cancelRemoval(playerId: string) {
    const player = this.players.get(playerId);
    if (player?.removalTimer) {
      clearTimeout(player.removalTimer);
      player.removalTimer = null;
    }
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  get joinedCount(): number {
    return this.players.size;
  }

  isFull(): boolean {
    return this.joinedCount >= this.maxPlayers;
  }

  isHost(playerId: string): boolean {
    return this.creatorId === playerId;
  }

  startLobby() {
    this.transition("LOBBY");
    this.lobbyStartAt = Date.now();
    this.autoCloseAt = this.lobbyStartAt + ROOM_AUTO_CLOSE_MS;
  }

  /** Locks the player list and builds the authoritative game from whoever is present. Returns false if not enough players. */
  lockAndStart(): boolean {
    if (this.joinedCount < 2) return false;
    this.transition("STARTING");
    const players = this.joinOrder
      .map((id) => this.players.get(id)!)
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, isGuest: p.isGuest, userId: p.userId }));
    this.game = createInitialGameState(players);
    this.transition("PLAYING");
    return true;
  }

  finish(winnerId: string) {
    this.transition("FINISHED");
    if (this.game) this.game.winnerId = winnerId;
  }

  expire() {
    if (this.status !== "EXPIRED") {
      this.status = "EXPIRED";
    }
    this.chat = []; // in-memory chat is destroyed with the room, never persisted
    if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
    for (const player of this.players.values()) {
      if (player.removalTimer) clearTimeout(player.removalTimer);
    }
  }

  addChatMessage(playerId: string, name: string, text: string): ChatMessage {
    const msg: ChatMessage = {
      id: randomUUID(),
      playerId,
      name,
      text: text.slice(0, CHAT_MAX_LEN),
      ts: Date.now(),
    };
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    return msg;
  }

  toLobbyState() {
    return {
      code: this.code,
      status: this.status,
      maxPlayers: this.maxPlayers,
      lobbyStartAt: this.lobbyStartAt,
      autoCloseAt: this.autoCloseAt,
      serverTime: Date.now(),
      players: this.joinOrder
        .map((id) => this.players.get(id))
        .filter((p): p is RoomPlayer => !!p)
        .map((p) => ({
          id: p.id,
          name: p.name,
          isGuest: p.isGuest,
          connected: p.connected,
          isCreator: p.id === this.creatorId,
        })),
    };
  }

  toGameStatePayload() {
    return { game: this.game, serverTime: Date.now() };
  }
}
