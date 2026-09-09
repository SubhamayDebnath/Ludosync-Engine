import { generateRoomCode } from "../util/code.js";
import { Room } from "./room.js";

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(maxPlayers: number): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(code, maxPlayers);
    room.status = "CREATING";
    this.rooms.set(code, room);
    // Note: no blind lifetime timer here. Pre-game idle rooms are closed by
    // Room's own ROOM_AUTO_CLOSE_MS timer (started when it enters LOBBY); an in-progress
    // match is never force-killed by a flat clock, only by the disconnect-forfeit flow.
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  expireRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.expire();
    this.rooms.delete(code);
  }

  /** Removes a finished/expired room a short while after it's no longer needed. */
  scheduleCleanup(code: string, delayMs = 60_000) {
    setTimeout(() => this.expireRoom(code), delayMs);
  }

  get size(): number {
    return this.rooms.size;
  }

  /** All rooms currently in memory — used by the admin API, never exposed to regular clients. */
  listRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}

export const roomManager = new RoomManager();
