import { Hono } from "hono";

export const healthRoutes = new Hono();

// Confirms the process is alive. Booting/cold-starting Render instances will
// answer this quickly, but it says NOTHING about WebSocket readiness.
healthRoutes.get("/health", (c) => c.json({ status: "ok", time: Date.now() }));

// Confirms the process can accept realtime traffic. The web client still must
// complete a real WebSocket handshake + engine:ready before creating a room.
healthRoutes.get("/ready", (c) => c.json({ status: "ready", time: Date.now() }));
