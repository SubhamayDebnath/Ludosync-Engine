import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { GameState, RoomStatus } from "../game/types.js";
import { createInitialGameState } from "../game/state.js";
import { assertTransition } from "./stateMachine.js";

export const LOBBY_DURATION_MS = Number(process.env.LOBBY_DURATION_MS_OVERRIDE) || 30_000;
export const ROOM_IDLE_EXPIRE_MS = 30 * 60_000; // safety net GC for abandoned rooms
export const RECONNECT_WINDOW_MS = 30_000;
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
}

export class Room {
  readonly code: string;
  readonly maxPlayers: number;
  creatorId: string;
  status: RoomStatus = "CREATING";
  createdAt = Date.now();
  lobbyStartAt: number | null = null;
  lobbyEndAt: number | null = null;
  players = new Map<string, RoomPlayer>();
  joinOrder: string[] = [];
  chat: ChatMessage[] = [];
  game: GameState | null = null;
  lobbyTimer: NodeJS.Timeout | null = null;
  expireTimer: NodeJS.Timeout | null = null;

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
    return player;
  }

  markDisconnected(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.ws = null;
    player.disconnectedAt = Date.now();
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
    this.lobbyEndAt = this.lobbyStartAt + LOBBY_DURATION_MS;
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
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    if (this.expireTimer) clearTimeout(this.expireTimer);
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
      lobbyEndAt: this.lobbyEndAt,
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
