import { customAlphabet } from "nanoid";

// Unambiguous uppercase alphabet (no 0/O, 1/I) for room codes that are easy to read aloud.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generate = customAlphabet(alphabet, 6);

export function generateRoomCode(): string {
  return generate();
}
