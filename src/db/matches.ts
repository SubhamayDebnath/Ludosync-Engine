import type { Db } from "mongodb";
import type { Room } from "../rooms/room.js";

const MAX_RECENT_MATCHES = 10;

/**
 * Persists the outcome of a finished game. Only authenticated users are stored
 * (guest results are not persisted, per spec). No-ops if MongoDB is not configured.
 */
export async function recordMatchResult(db: Db | null, room: Room, winnerId: string) {
  if (!db || !room.game) return;

  const statsCol = db.collection("statistics");
  const recentCol = db.collection("recentMatches");
  const finishedAt = new Date();

  const playersSummary = room.game.players.map((p) => ({
    name: p.name,
    color: p.color,
    isGuest: p.isGuest,
    userId: p.userId,
  }));

  for (const player of room.game.players) {
    if (player.isGuest || !player.userId) continue; // guest stats are not persisted

    const won = player.id === winnerId;
    await statsCol.updateOne(
      { userId: player.userId },
      {
        $inc: { games: 1, wins: won ? 1 : 0, losses: won ? 0 : 1 },
        $set: { updatedAt: finishedAt },
      },
      { upsert: true },
    );

    await recentCol.insertOne({
      userId: player.userId,
      roomCode: room.code,
      result: won ? "win" : "loss",
      players: playersSummary,
      finishedAt,
    });

    // Keep only the most recent MAX_RECENT_MATCHES per user; drop the oldest beyond that.
    const excess = await recentCol
      .find({ userId: player.userId })
      .sort({ finishedAt: -1 })
      .skip(MAX_RECENT_MATCHES)
      .project({ _id: 1 })
      .toArray();
    if (excess.length > 0) {
      await recentCol.deleteMany({ _id: { $in: excess.map((d) => d._id) } });
    }
  }
}
