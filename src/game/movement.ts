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
  const legal = legalMovesForPlayer(state, player, state.currentDice);
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

  // Indian Ludo bonus-roll rule: a 6 OR landing a capture earns another roll.
  const rolledSix = state.currentDice === 6;
  const capturedAny = captures.length > 0;
  const grantExtraTurn = (rolledSix || capturedAny) && !wonNow;
  const bonusReason: LastMoveInfo["bonusReason"] | undefined = !grantExtraTurn
    ? undefined
    : rolledSix && capturedAny
      ? "six_and_capture"
      : rolledSix
        ? "six"
        : "capture";

  state.currentDice = null;
  state.diceRolledThisTurn = false;
  if (!grantExtraTurn && !wonNow) {
    advanceTurn(state);
  }
  state.version += 1;

  return {
    ok: true,
    info: { playerId: player.id, pieceId, from, to: move.toSteps, captured: captures, bonusReason },
    wonPlayerId: wonNow ? player.id : undefined,
  };
}

/** Moves turnIndex to the next player who still holds an active, in-play seat. */
export function advanceTurn(state: GameState): void {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.turnIndex + i) % n;
    const candidate = state.players[idx];
    if (!candidate.left && !candidate.finished) {
      state.turnIndex = idx;
      return;
    }
  }
  // No eligible player found (everyone else has left or finished) — leave turnIndex as-is;
  // the caller is expected to have already ended the game in this case.
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
