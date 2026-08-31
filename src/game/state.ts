import { COLORS, GameState, Piece, PlayerState, Color } from "./types.js";

export interface NewPlayerInput {
  id: string;
  name: string;
  isGuest: boolean;
  userId: string | null;
}

function makePieces(color: Color): Piece[] {
  return [0, 1, 2, 3].map((i) => ({ id: `${color}-${i}`, color, steps: 0 }));
}

/** Assigns colors in join order and builds the initial authoritative game state. */
export function createInitialGameState(players: NewPlayerInput[]): GameState {
  const assigned: PlayerState[] = players.map((p, i) => {
    const color = COLORS[i % COLORS.length];
    return {
      id: p.id,
      color,
      name: p.name,
      isGuest: p.isGuest,
      userId: p.userId,
      connected: true,
      pieces: makePieces(color),
      finished: false,
    };
  });

  return {
    status: "PLAYING",
    players: assigned,
    turnIndex: 0,
    currentDice: null,
    diceRolledThisTurn: false,
    consecutiveSixes: 0,
    winnerId: null,
    version: 1,
  };
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[state.turnIndex];
}

export function bumpVersion(state: GameState): void {
  state.version += 1;
}
