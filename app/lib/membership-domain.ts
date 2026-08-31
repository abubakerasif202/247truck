import { createHash, randomBytes } from "node:crypto";

export const MEMBERSHIP_TIME_ZONE = "Australia/Adelaide";

export type MembershipStatus = "active" | "expired" | "cancelled";

function dateParts(value: Date, timeZone = MEMBERSHIP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function adelaideBusinessDate(value = new Date()) {
  const { year, month, day } = dateParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addOneCalendarYear(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("Invalid business date");
  const [year, month, day] = date.split("-").map(Number);
  const nextYear = year + 1;
  const lastDay = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  return `${nextYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function membershipStatus(
  storedStatus: "active" | "cancelled",
  expiryDate: string,
  now = new Date(),
): MembershipStatus {
  if (storedStatus === "cancelled") return "cancelled";
  return adelaideBusinessDate(now) > expiryDate ? "expired" : "active";
}

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCode(length: number) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function generateMembershipNumber(now = new Date()) {
  const year = adelaideBusinessDate(now).slice(2, 4);
  return `247-RA-${year}-${randomCode(5)}`;
}

export function generatePublicAccessToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPublicAccessToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

