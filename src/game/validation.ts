import type { GameState } from "./types.js";
import { currentPlayer } from "./state.js";
import { legalMovesForPlayer } from "./rules.js";

export function isPlayersTurn(state: GameState, playerId: string): boolean {
  return state.status === "PLAYING" && currentPlayer(state).id === playerId;
}

export function canRollDice(state: GameState, playerId: string): boolean {
  return isPlayersTurn(state, playerId) && !state.diceRolledThisTurn;
}

export function canRequestMove(state: GameState, playerId: string, pieceId: string): boolean {
  if (!isPlayersTurn(state, playerId)) return false;
  if (state.currentDice === null) return false;
  const legal = legalMovesForPlayer(currentPlayer(state), state.currentDice);
  return legal.some((m) => m.pieceId === pieceId);
}

/** True if the current player has no legal move for the dice they just rolled. */
export function playerHasNoLegalMoves(state: GameState): boolean {
  if (state.currentDice === null) return false;
  return legalMovesForPlayer(currentPlayer(state), state.currentDice).length === 0;
}
