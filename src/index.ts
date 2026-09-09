import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import { healthRoutes } from "./routes/health.js";
import { adminRoutes } from "./routes/admin.js";
import { handleConnection } from "./websocket/handlers.js";
import { getDb } from "./db/mongo.js";

const PORT = Number(process.env.PORT) || 10000;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: WEB_ORIGIN, // never "*" in production, per spec section 39
    credentials: true,
  }),
);

app.route("/", healthRoutes);
app.route("/admin", adminRoutes);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`ludo-engine listening on :${info.port}`);
});

// Attach a raw WebSocket server on the same HTTP server for realtime traffic.
const wss = new WebSocketServer({ server: server as unknown as import("node:http").Server });

wss.on("connection", (ws) => {
  handleConnection(ws, getDb);
});

process.on("SIGTERM", () => {
  wss.close();
  server.close();
  process.exit(0);
});
