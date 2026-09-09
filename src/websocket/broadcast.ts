import type { WebSocket } from "ws";
import type { Room } from "../rooms/room.js";

export function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

export function broadcast(room: Room, payload: unknown, exceptPlayerId?: string) {
  for (const player of room.players.values()) {
    if (exceptPlayerId && player.id === exceptPlayerId) continue;
    if (player.ws) send(player.ws, payload);
  }
}

export function broadcastRoomState(room: Room) {
  broadcast(room, { type: "room:state", room: room.toLobbyState() });
}

export function broadcastGameState(room: Room, lastMove?: unknown) {
  broadcast(room, { type: "game:state", ...room.toGameStatePayload(), lastMove: lastMove ?? null });
}
