import { randomInt } from "node:crypto";

/** Engine-authoritative dice roll. Never trust a client-supplied value. */
export function rollDice(): number {
  return randomInt(1, 7); // 1-6 inclusive
}
