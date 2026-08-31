export type Color = "red" | "green" | "yellow" | "blue";

export const COLORS: Color[] = ["red", "green", "yellow", "blue"];

/** Global common-track start offset (0-51) for each color. */
export const START_OFFSET: Record<Color, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

/** Global common-track squares that are safe (no captures). */
export const SAFE_SQUARES: number[] = [0, 8, 13, 21, 26, 34, 39, 47];

export const COMMON_TRACK_LENGTH = 52; // steps 1..52 walk the shared ring
export const HOME_COLUMN_LENGTH = 6; // steps 53..58 walk the private column
export const FINISH_STEP = COMMON_TRACK_LENGTH + HOME_COLUMN_LENGTH; // 58

export interface Piece {
  id: string; // e.g. "red-0"
  color: Color;
  /** 0 = in yard, 1-52 = common track, 53-58 = home column, 58 = finished (home) */
  steps: number;
}

export interface PlayerState {
  id: string; // stable player/session id assigned by engine
  color: Color;
  name: string;
  isGuest: boolean;
  userId: string | null; // present if authenticated
  connected: boolean;
  pieces: Piece[];
  finished: boolean;
}

export type RoomStatus =
  | "CREATING"
  | "READY"
  | "LOBBY"
  | "STARTING"
  | "PLAYING"
  | "FINISHED"
  | "EXPIRED";

export interface GameState {
  status: RoomStatus;
  players: PlayerState[]; // turn order
  turnIndex: number;
  currentDice: number | null;
  diceRolledThisTurn: boolean;
  consecutiveSixes: number;
  winnerId: string | null;
  version: number;
}

export interface LastMoveInfo {
  playerId: string;
  pieceId: string;
  from: number;
  to: number;
  captured: { playerId: string; pieceId: string }[];
}
