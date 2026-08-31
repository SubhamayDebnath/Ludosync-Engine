import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../src/game/state.js";
import {
  findCaptures,
  globalSquare,
  hasWon,
  isSafeSquare,
  isTripleSix,
  legalMovesForPlayer,
} from "../src/game/rules.js";
import { FINISH_STEP } from "../src/game/types.js";

function twoPlayerState() {
  return createInitialGameState([
    { id: "p1", name: "Alice", isGuest: false, userId: "u1" },
    { id: "p2", name: "Bob", isGuest: true, userId: null },
  ]);
}

describe("legalMovesForPlayer", () => {
  it("only allows leaving the yard on a 6", () => {
    const state = twoPlayerState();
    const player = state.players[0];
    expect(legalMovesForPlayer(player, 5)).toHaveLength(0);
    const moves = legalMovesForPlayer(player, 6);
    expect(moves).toHaveLength(4); // all 4 pieces can leave yard
    expect(moves[0].toSteps).toBe(1);
  });

  it("does not allow overshooting the finish step", () => {
    const state = twoPlayerState();
    const player = state.players[0];
    player.pieces[0].steps = FINISH_STEP - 2;
    const moves = legalMovesForPlayer(player, 5);
    expect(moves.find((m) => m.pieceId === player.pieces[0].id)).toBeUndefined();
    const okMoves = legalMovesForPlayer(player, 2);
    expect(okMoves.find((m) => m.pieceId === player.pieces[0].id)?.toSteps).toBe(FINISH_STEP);
  });

  it("ignores pieces already finished", () => {
    const state = twoPlayerState();
    const player = state.players[0];
    player.pieces[0].steps = FINISH_STEP;
    const moves = legalMovesForPlayer(player, 6);
    expect(moves.find((m) => m.pieceId === player.pieces[0].id)).toBeUndefined();
  });
});

describe("safe squares", () => {
  it("marks known start/star squares as safe", () => {
    expect(isSafeSquare(0)).toBe(true);
    expect(isSafeSquare(8)).toBe(true);
    expect(isSafeSquare(1)).toBe(false);
  });
});

describe("captures", () => {
  it("sends an opponent piece back to the yard when landed on off a safe square", () => {
    const state = twoPlayerState();
    const [p1, p2] = state.players;
    // p1 is red (offset 0), p2 is green (offset 13) in a 2-player game (index 1 -> green)
    // Put p2's piece on a common-track square that p1 can land on and is NOT safe.
    const targetSquare = 5; // not in SAFE_SQUARES
    // p2's global square = (13 + steps - 1) % 52 = 5  => steps = (5 - 13 + 1 + 52) % 52 = 45
    const p2Steps = ((targetSquare - 13 + 1) % 52 + 52) % 52 || 52;
    p2.pieces[0].steps = p2Steps;
    expect(globalSquare(p2.pieces[0], p2Steps)).toBe(targetSquare);

    // p1 piece moving to the same global square: steps such that (0 + steps - 1) % 52 === 5 => steps = 6
    const captures = findCaptures(state, p1, 6);
    expect(captures).toHaveLength(1);
    expect(captures[0].pieceId).toBe(p2.pieces[0].id);
  });

  it("never captures on a safe square", () => {
    const state = twoPlayerState();
    const [p1, p2] = state.players;
    // Green start square (13) is safe. Put p2 piece there (steps=1 => global square 13).
    p2.pieces[0].steps = 1;
    expect(globalSquare(p2.pieces[0], 1)).toBe(13);
    // p1 moving to global square 13: steps such that (0+steps-1)%52 === 13 => steps=14
    const captures = findCaptures(state, p1, 14);
    expect(captures).toHaveLength(0);
  });

  it("never captures in the home column", () => {
    const state = twoPlayerState();
    const [p1] = state.players;
    const captures = findCaptures(state, p1, 55); // home column step
    expect(captures).toHaveLength(0);
  });
});

describe("hasWon", () => {
  it("is true only once all four pieces are finished", () => {
    const state = twoPlayerState();
    const player = state.players[0];
    expect(hasWon(player)).toBe(false);
    for (const piece of player.pieces) piece.steps = FINISH_STEP;
    expect(hasWon(player)).toBe(true);
  });
});

describe("triple six rule", () => {
  it("forfeits the turn on the third consecutive six", () => {
    expect(isTripleSix(0, 6)).toBe(false);
    expect(isTripleSix(1, 6)).toBe(false);
    expect(isTripleSix(2, 6)).toBe(true);
    expect(isTripleSix(2, 5)).toBe(false);
  });
});
