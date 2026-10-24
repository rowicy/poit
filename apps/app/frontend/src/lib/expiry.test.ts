import { describe, expect, it } from "vitest";
import { expiryWarning } from "./expiry";

const now = new Date("2026-10-24T00:00:00Z").getTime();
const inDays = (d: number) => new Date(now + d * 24 * 60 * 60 * 1000).toISOString();

describe("expiryWarning", () => {
  it("stays quiet while the discard is further out than 30 days", () => {
    expect(expiryWarning({ persist: false, expiresAt: inDays(90) }, now)).toBeNull();
    expect(expiryWarning({ persist: false, expiresAt: inDays(31) }, now)).toBeNull();
  });

  it("warns from 30 days out, counting the days left", () => {
    expect(expiryWarning({ persist: false, expiresAt: inDays(30) }, now)).toContain("あと30日で廃棄");
    expect(expiryWarning({ persist: false, expiresAt: inDays(2) }, now)).toContain("あと2日で廃棄");
  });

  it("treats the last day (or an already-past expiry) as imminent", () => {
    expect(expiryWarning({ persist: false, expiresAt: inDays(0.5) }, now)).toContain("まもなく廃棄");
    expect(expiryWarning({ persist: false, expiresAt: inDays(-3) }, now)).toContain("まもなく廃棄");
  });

  it("never warns for a persisted artifact, or one with no expiry", () => {
    expect(expiryWarning({ persist: true, expiresAt: inDays(1) }, now)).toBeNull();
    expect(expiryWarning({ persist: false }, now)).toBeNull();
  });
});
