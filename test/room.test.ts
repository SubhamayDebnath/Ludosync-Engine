import { describe, expect, it } from "vitest";
import { Room } from "../src/rooms/room.js";
import { canTransition } from "../src/rooms/stateMachine.js";

describe("room state machine", () => {
  it("allows the documented valid transitions", () => {
    expect(canTransition("CREATING", "READY")).toBe(true);
    expect(canTransition("READY", "LOBBY")).toBe(true);
    expect(canTransition("LOBBY", "STARTING")).toBe(true);
    expect(canTransition("STARTING", "PLAYING")).toBe(true);
    expect(canTransition("PLAYING", "FINISHED")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("FINISHED", "PLAYING")).toBe(false);
    expect(canTransition("CREATING", "PLAYING")).toBe(false);
    expect(canTransition("EXPIRED", "LOBBY")).toBe(false);
  });
});

describe("Room", () => {
  it("refuses to start and stays in LOBBY with fewer than 2 players", () => {
    const room = new Room("AB12CD", 4);
    room.transition("READY");
    const p1 = room.addPlayer({ name: "Alice", isGuest: false, userId: "u1" });
    room.creatorId = p1.id;
    room.startLobby();
    expect(room.status).toBe("LOBBY");

    const started = room.lockAndStart();
    expect(started).toBe(false); // only 1 player joined
    expect(room.status).toBe("LOBBY"); // never transitions on a failed start
  });

  it("starts a game once at least 2 players have joined", () => {
    const room = new Room("XY9KQ2", 4);
    room.transition("READY");
    const p1 = room.addPlayer({ name: "Alice", isGuest: false, userId: "u1" });
    room.creatorId = p1.id;
    room.addPlayer({ name: "Bob", isGuest: true, userId: null });
    room.startLobby();

    const started = room.lockAndStart();
    expect(started).toBe(true);
    expect(room.status).toBe("PLAYING");
    expect(room.game?.players).toHaveLength(2);
    expect(room.game?.players[0].color).toBe("red");
    // 2-player games seat colors diagonally opposite (red + yellow), not side-by-side.
    expect(room.game?.players[1].color).toBe("yellow");
  });

  it("destroys chat when the room expires", () => {
    const room = new Room("ZZ0011", 4);
    room.transition("READY");
    const p1 = room.addPlayer({ name: "Alice", isGuest: false, userId: null });
    room.addChatMessage(p1.id, "Alice", "hello");
    expect(room.chat).toHaveLength(1);
    room.expire();
    expect(room.chat).toHaveLength(0);
  });
});
