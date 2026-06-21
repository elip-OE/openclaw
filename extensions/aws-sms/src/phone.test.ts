// Aws Sms tests cover phone plugin behavior.
import { describe, expect, it } from "vitest";
import {
  looksLikeAwsSmsPhoneNumber,
  normalizeAwsSmsAllowFrom,
  normalizeAwsSmsPhoneNumber,
} from "./phone.js";

describe("normalizeAwsSmsPhoneNumber", () => {
  it("normalizes aws-sms targets and strips formatting", () => {
    expect(normalizeAwsSmsPhoneNumber("aws-sms:+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizeAwsSmsPhoneNumber("15551234567")).toBe("+15551234567");
  });
});

describe("looksLikeAwsSmsPhoneNumber", () => {
  it("accepts E.164 numbers", () => {
    expect(looksLikeAwsSmsPhoneNumber("+15551234567")).toBe(true);
    expect(looksLikeAwsSmsPhoneNumber("invalid")).toBe(false);
  });
});

describe("normalizeAwsSmsAllowFrom", () => {
  it("preserves wildcard allowlist entries", () => {
    expect(normalizeAwsSmsAllowFrom("*")).toBe("*");
    expect(normalizeAwsSmsAllowFrom("+15551234567")).toBe("+15551234567");
  });
});
