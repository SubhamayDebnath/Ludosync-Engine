import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(24);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room:create"),
    maxPlayers: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    name: nameSchema,
    isGuest: z.boolean(),
    userId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("room:join"),
    code: z.string().trim().min(4).max(8),
    name: nameSchema,
    isGuest: z.boolean(),
    userId: z.string().nullable().optional(),
    playerToken: z.string().optional(), // present when attempting to reclaim an existing seat
  }),
  z.object({ type: z.literal("chat:send"), text: z.string().min(1).max(150) }),
  z.object({ type: z.literal("dice:request") }),
  z.object({ type: z.literal("move:request"), pieceId: z.string().min(1).max(16) }),
  // Host-only: end the lobby countdown early once the minimum player count is met.
  z.object({ type: z.literal("room:start_now") }),
  // Player-initiated graceful leave (distinct from a dropped connection).
  z.object({ type: z.literal("room:leave") }),
  // Reply to a server-initiated heartbeat ping; server computes RTT itself (client clock is never trusted).
  z.object({ type: z.literal("pong"), t: z.number() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(raw: unknown) {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
