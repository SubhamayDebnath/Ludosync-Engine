import { FINISH_STEP } from "./types.js";
import type { GameState, LastMoveInfo } from "./types.js";
import { currentPlayer } from "./state.js";
import { findCaptures, hasWon, legalMovesForPlayer } from "./rules.js";

export interface ApplyMoveResult {
  ok: boolean;
  error?: string;
  info?: LastMoveInfo;
  wonPlayerId?: string;
}

/**
 * Applies a validated move to the authoritative state. Mutates `state` in place.
 * This is the ONLY function allowed to change piece positions.
 */
export function applyMove(state: GameState, pieceId: string): ApplyMoveResult {
  if (state.status !== "PLAYING") return { ok: false, error: "game_not_active" };
  if (state.currentDice === null) return { ok: false, error: "no_dice_rolled" };

  const player = currentPlayer(state);
  const legal = legalMovesForPlayer(player, state.currentDice);
  const move = legal.find((m) => m.pieceId === pieceId);
  if (!move) return { ok: false, error: "illegal_move" };

  const piece = player.pieces.find((p) => p.id === pieceId)!;
  const from = piece.steps;
  const captures = findCaptures(state, player, move.toSteps);

  piece.steps = move.toSteps;
  for (const cap of captures) {
    const opponent = state.players.find((p) => p.id === cap.playerId)!;
    const capturedPiece = opponent.pieces.find((p) => p.id === cap.pieceId)!;
    capturedPiece.steps = 0;
  }

  const wonNow = hasWon(player);
  if (wonNow) {
    player.finished = true;
    state.winnerId = player.id;
    state.status = "FINISHED";
  }

  const grantExtraTurn = state.currentDice === 6 && !wonNow;
  state.currentDice = null;
  state.diceRolledThisTurn = false;
  if (!grantExtraTurn && !wonNow) {
    advanceTurn(state);
  }
  state.version += 1;

  return {
    ok: true,
    info: { playerId: player.id, pieceId, from, to: move.toSteps, captured: captures },
    wonPlayerId: wonNow ? player.id : undefined,
  };
}

/** Moves turnIndex to the next player who still has an active seat. */
export function advanceTurn(state: GameState): void {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.turnIndex + i) % n;
    state.turnIndex = idx;
    return;
  }
}

/** Skips the current player's turn (used when they have no legal moves, or on triple-six forfeit). */
export function skipTurn(state: GameState): void {
  state.currentDice = null;
  state.diceRolledThisTurn = false;
  state.consecutiveSixes = 0;
  advanceTurn(state);
  state.version += 1;
}

export function pieceHasFinishedAll(steps: number): boolean {
  return steps === FINISH_STEP;
}
