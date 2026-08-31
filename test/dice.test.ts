import { describe, expect, it } from "vitest";
import { rollDice } from "../src/game/dice.js";

describe("rollDice", () => {
  it("always returns a value between 1 and 6", () => {
    for (let i = 0; i < 1000; i++) {
      const value = rollDice();
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
