import { Hono } from "hono";
import { roomManager } from "../rooms/roomManager.js";
import type { Room } from "../rooms/room.js";
import { broadcast } from "../websocket/broadcast.js";

/**
 * Internal admin API. Never called directly from a browser — the Next.js server proxies
 * requests here (see /api/admin/* in the web app) after checking the signed-in user is an
 * admin, then forwards with the shared secret below. If ADMIN_API_KEY isn't set, these
 * routes refuse everything rather than silently running unauthenticated.
 */
export const adminRoutes = new Hono();

adminRoutes.use("*", async (c, next) => {
  const configured = process.env.ADMIN_API_KEY;
  if (!configured) return c.json({ error: "admin_api_disabled" }, 503);
  const provided = c.req.header("x-admin-key");
  if (!provided || provided !== configured) return c.json({ error: "unauthorized" }, 401);
  await next();
});

function summarizeRoom(room: Room) {
  const connectedCount = Array.from(room.players.values()).filter((p) => p.connected).length;
  return {
    code: room.code,
    status: room.status,
    maxPlayers: room.maxPlayers,
    playerCount: room.players.size,
    connectedCount,
    createdAt: room.createdAt,
    lobbyStartAt: room.lobbyStartAt,
    autoCloseAt: room.autoCloseAt,
    winnerId: room.game?.winnerId ?? null,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isGuest: p.isGuest,
      connected: p.connected,
      pingMs: p.pingMs,
    })),
  };
}

adminRoutes.get("/rooms", (c) => {
  const rooms = roomManager.listRooms().map(summarizeRoom);
  return c.json({ rooms });
});

adminRoutes.get("/stats", (c) => {
  const rooms = roomManager.listRooms();
  const byStatus: Record<string, number> = {};
  let totalPlayers = 0;
  for (const room of rooms) {
    byStatus[room.status] = (byStatus[room.status] ?? 0) + 1;
    totalPlayers += room.players.size;
  }
  return c.json({ totalRooms: rooms.length, totalPlayers, byStatus });
});

adminRoutes.post("/rooms/:code/close", (c) => {
  const code = c.req.param("code").toUpperCase();
  const room = roomManager.get(code);
  if (!room) return c.json({ error: "room_not_found" }, 404);

  room.expire();
  broadcast(room, { type: "room:expired", reason: "admin_closed" });
  roomManager.expireRoom(code);
  return c.json({ ok: true });
});
