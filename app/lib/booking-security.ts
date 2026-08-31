import { createHash, randomBytes } from "node:crypto";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (value) => REFERENCE_ALPHABET[value % REFERENCE_ALPHABET.length]).join("");
}

export function createBookingReference(date: string) {
  return `247-WA-${date.slice(2).replaceAll("-", "")}-${randomCode(4)}`;
}

export function createCancellationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashCancellationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validCancellationToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/u.test(token);
}
