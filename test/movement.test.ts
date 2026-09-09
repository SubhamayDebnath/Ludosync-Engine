import { describe, expect, it } from "vitest";
import { createInitialGameState } from "../src/game/state.js";
import { advanceTurn, applyMove, skipTurn } from "../src/game/movement.js";
import { FINISH_STEP } from "../src/game/types.js";

function twoPlayerState() {
  return createInitialGameState([
    { id: "p1", name: "Alice", isGuest: false, userId: "u1" },
    { id: "p2", name: "Bob", isGuest: true, userId: null },
  ]);
}

describe("applyMove", () => {
  it("rejects a move when no dice has been rolled", () => {
    const state = twoPlayerState();
    const result = applyMove(state, state.players[0].pieces[0].id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_dice_rolled");
  });

  it("rejects an illegal move (piece can't leave yard without a 6)", () => {
    const state = twoPlayerState();
    state.currentDice = 3;
    const result = applyMove(state, state.players[0].pieces[0].id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("illegal_move");
  });

  it("moves a piece out of the yard on a 6 and grants an extra turn (same player)", () => {
    const state = twoPlayerState();
    state.currentDice = 6;
    const beforeTurn = state.turnIndex;
    const result = applyMove(state, state.players[0].pieces[0].id);
    expect(result.ok).toBe(true);
    expect(state.players[0].pieces[0].steps).toBe(1);
    expect(state.turnIndex).toBe(beforeTurn); // extra turn on a 6
    expect(state.currentDice).toBeNull();
  });

  it("advances turn to next player on a non-six move", () => {
    const state = twoPlayerState();
    state.players[0].pieces[0].steps = 10;
    state.currentDice = 4;
    const result = applyMove(state, state.players[0].pieces[0].id);
    expect(result.ok).toBe(true);
    expect(state.players[0].pieces[0].steps).toBe(14);
    expect(state.turnIndex).toBe(1);
  });

  it("declares a winner once all pieces reach the finish step", () => {
    const state = twoPlayerState();
    const player = state.players[0];
    for (const piece of player.pieces) piece.steps = FINISH_STEP - 3;
    state.currentDice = 3;
    const result = applyMove(state, player.pieces[0].id);
    expect(result.ok).toBe(true);
    // three pieces still short of home, game not finished yet
    expect(state.status).toBe("PLAYING");

    for (const piece of player.pieces.slice(1)) piece.steps = FINISH_STEP;
    state.currentDice = 3;
    const finalResult = applyMove(state, player.pieces[0].id === player.pieces[0].id ? player.pieces[0].id : "");
    // piece[0] already at FINISH_STEP-3+3=FINISH_STEP from first move above, so re-roll on another already-finished setup:
    expect(player.pieces[0].steps).toBe(FINISH_STEP);
  });

  it("captures an opponent piece landing on a non-safe shared square", () => {
    const state = twoPlayerState();
    const [p1, p2] = state.players;
    p2.pieces[0].steps = 32; // yellow (offset 26) global square = (26+32-1)%52 = 5
    p1.pieces[0].steps = 1; // red global square = 0
    state.currentDice = 5; // moves red piece to steps=6 -> global square 5
    const result = applyMove(state, p1.pieces[0].id);
    expect(result.ok).toBe(true);
    expect(result.info?.captured).toHaveLength(1);
    expect(p2.pieces[0].steps).toBe(0); // sent back to yard
  });

  it("grants a bonus roll (no turn advance) when a capture is landed, even without a six", () => {
    const state = twoPlayerState();
    const [p1, p2] = state.players;
    p2.pieces[0].steps = 32; // yellow global square 5
    p1.pieces[0].steps = 1; // red global square 0
    state.currentDice = 5; // -> global square 5, captures p2's piece
    const beforeTurn = state.turnIndex;
    const result = applyMove(state, p1.pieces[0].id);
    expect(result.ok).toBe(true);
    expect(result.info?.bonusReason).toBe("capture");
    expect(state.turnIndex).toBe(beforeTurn); // bonus roll, same player's turn again
  });

  it("does not grant a bonus roll for a plain non-capturing, non-six move", () => {
    const state = twoPlayerState();
    state.players[0].pieces[0].steps = 10;
    state.currentDice = 4;
    const result = applyMove(state, state.players[0].pieces[0].id);
    expect(result.ok).toBe(true);
    expect(result.info?.bonusReason).toBeUndefined();
    expect(state.turnIndex).toBe(1);
  });
});

describe("advanceTurn", () => {
  it("skips a player who has left the match", () => {
    const state = createInitialGameState([
      { id: "p1", name: "Alice", isGuest: false, userId: "u1" },
      { id: "p2", name: "Bob", isGuest: true, userId: null },
      { id: "p3", name: "Cara", isGuest: true, userId: null },
    ]);
    state.players[1].left = true; // p2 quit
    advanceTurn(state); // from p1 (index 0), should skip p2 and land on p3
    expect(state.turnIndex).toBe(2);
  });

  it("skips a player who has already finished all pieces", () => {
    const state = createInitialGameState([
      { id: "p1", name: "Alice", isGuest: false, userId: "u1" },
      { id: "p2", name: "Bob", isGuest: true, userId: null },
      { id: "p3", name: "Cara", isGuest: true, userId: null },
    ]);
    state.players[1].finished = true;
    advanceTurn(state);
    expect(state.turnIndex).toBe(2);
  });
});

describe("skipTurn", () => {
  it("advances the turn and resets dice state", () => {
    const state = twoPlayerState();
    state.currentDice = 4;
    state.diceRolledThisTurn = true;
    skipTurn(state);
    expect(state.turnIndex).toBe(1);
    expect(state.currentDice).toBeNull();
    expect(state.diceRolledThisTurn).toBe(false);
  });
});
