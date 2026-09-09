import {
  COMMON_TRACK_LENGTH,
  Color,
  FINISH_STEP,
  GameState,
  Piece,
  PlayerState,
  SAFE_SQUARES,
  START_OFFSET,
} from "./types.js";

/** Maps a piece's private step count to a global common-track square (0-51). Only valid for 1<=steps<=52. */
export function globalSquare(piece: Piece, steps: number): number {
  const offset = START_OFFSET[piece.color];
  return (offset + (steps - 1)) % 52;
}

/** Whether a global common-track square is a safe square (no captures allowed there). */
export function isSafeSquare(square: number): boolean {
  return SAFE_SQUARES.includes(square);
}

/** True if steps value is on the shared 52-square ring (not yard, not home column, not finished). */
export function isOnCommonTrack(steps: number): boolean {
  return steps >= 1 && steps <= 52;
}

export interface LegalMove {
  pieceId: string;
  fromSteps: number;
  toSteps: number;
}

/**
 * Indian Ludo "block" rule: two or more of one player's pieces stacked on the same
 * common-track square form a block that no opponent piece may land on. (We don't simulate
 * passing over intermediate squares — only the landing square — since this engine, like most
 * online Ludo implementations, moves pieces by total step count rather than square-by-square.)
 */
export function isBlockedForOpponent(state: GameState, movingColor: Color, square: number): boolean {
  for (const opponent of state.players) {
    if (opponent.color === movingColor) continue;
    const stackedHere = opponent.pieces.filter(
      (p) => isOnCommonTrack(p.steps) && globalSquare(p, p.steps) === square,
    ).length;
    if (stackedHere >= 2) return true;
  }
  return false;
}

/** All legal moves for the current player given the rolled dice. */
export function legalMovesForPlayer(state: GameState, player: PlayerState, dice: number): LegalMove[] {
  const moves: LegalMove[] = [];
  for (const piece of player.pieces) {
    if (piece.steps === FINISH_STEP) continue; // already home
    if (piece.steps === 0) {
      if (dice === 6) {
        const entrySquare = globalSquare({ color: player.color } as Piece, 1);
        if (!isBlockedForOpponent(state, player.color, entrySquare)) {
          moves.push({ pieceId: piece.id, fromSteps: 0, toSteps: 1 });
        }
      }
      continue;
    }
    const target = piece.steps + dice;
    if (target <= FINISH_STEP) {
      if (target <= COMMON_TRACK_LENGTH) {
        const landingSquare = globalSquare(piece, target);
        if (isBlockedForOpponent(state, player.color, landingSquare)) continue;
      }
      moves.push({ pieceId: piece.id, fromSteps: piece.steps, toSteps: target });
    }
  }
  return moves;
}

/** Finds opponent pieces that would be captured if a piece lands on `toSteps`. */
export function findCaptures(state: GameState, movingPlayer: PlayerState, toSteps: number) {
  const captured: { playerId: string; pieceId: string }[] = [];
  if (!isOnCommonTrack(toSteps)) return captured; // home column / finish are always safe

  const landingSquare = globalSquare({ color: movingPlayer.color } as Piece, toSteps);
  if (isSafeSquare(landingSquare)) return captured;

  for (const opponent of state.players) {
    if (opponent.id === movingPlayer.id) continue;
    for (const piece of opponent.pieces) {
      if (!isOnCommonTrack(piece.steps)) continue;
      const opponentSquare = globalSquare(piece, piece.steps);
      if (opponentSquare === landingSquare) {
        captured.push({ playerId: opponent.id, pieceId: piece.id });
      }
    }
  }
  return captured;
}

export function hasWon(player: PlayerState): boolean {
  return player.pieces.every((p) => p.steps === FINISH_STEP);
}

/** Consecutive-sixes rule: three 6s in a row forfeits the turn with no move applied. */
export function isTripleSix(consecutiveSixes: number, dice: number): boolean {
  return dice === 6 && consecutiveSixes >= 2;
}

/** A dice roll of 6 grants another roll, unless it was the forfeiting third six. */
export function grantsExtraTurn(dice: number, tripleSix: boolean): boolean {
  return dice === 6 && !tripleSix;
}
