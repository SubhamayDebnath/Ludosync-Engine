import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminRoutes } from "../src/routes/admin.js";
import { roomManager } from "../src/rooms/roomManager.js";

const ORIGINAL_KEY = process.env.ADMIN_API_KEY;

beforeEach(() => {
  process.env.ADMIN_API_KEY = "test-secret";
});

afterEach(() => {
  process.env.ADMIN_API_KEY = ORIGINAL_KEY;
});

describe("admin routes auth guard", () => {
  it("refuses requests with no key configured", async () => {
    delete process.env.ADMIN_API_KEY;
    const res = await adminRoutes.request("/rooms");
    expect(res.status).toBe(503);
  });

  it("refuses requests with a missing or wrong key", async () => {
    const res = await adminRoutes.request("/rooms");
    expect(res.status).toBe(401);
    const res2 = await adminRoutes.request("/rooms", { headers: { "x-admin-key": "wrong" } });
    expect(res2.status).toBe(401);
  });

  it("accepts requests with the correct key", async () => {
    const res = await adminRoutes.request("/rooms", { headers: { "x-admin-key": "test-secret" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rooms)).toBe(true);
  });
});

describe("admin room listing and closing", () => {
  it("lists a created room and can force-close it", async () => {
    const room = roomManager.createRoom(4);
    room.transition("READY");
    room.addPlayer({ name: "Alice", isGuest: true, userId: null });
    room.startLobby();

    const listRes = await adminRoutes.request("/rooms", { headers: { "x-admin-key": "test-secret" } });
    const listBody = await listRes.json();
    expect(listBody.rooms.some((r: { code: string }) => r.code === room.code)).toBe(true);

    const closeRes = await adminRoutes.request(`/rooms/${room.code}/close`, {
      method: "POST",
      headers: { "x-admin-key": "test-secret" },
    });
    expect(closeRes.status).toBe(200);
    expect(roomManager.get(room.code)).toBeUndefined();
  });

  it("404s when closing a room that doesn't exist", async () => {
    const res = await adminRoutes.request("/rooms/ZZZZZZ/close", {
      method: "POST",
      headers: { "x-admin-key": "test-secret" },
    });
    expect(res.status).toBe(404);
  });
});
