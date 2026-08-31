import type { RoomStatus } from "../game/types.js";

const VALID_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  CREATING: ["READY"],
  READY: ["LOBBY"],
  LOBBY: ["STARTING", "EXPIRED"],
  STARTING: ["PLAYING", "EXPIRED"],
  PLAYING: ["FINISHED"],
  FINISHED: ["EXPIRED"],
  EXPIRED: [],
};

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RoomStatus, to: RoomStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid room transition: ${from} -> ${to}`);
  }
}
