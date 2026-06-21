// Aws Sms plugin module implements phone behavior.
export function normalizeAwsSmsPhoneNumber(raw: string): string {
  const trimmed = raw.trim().replace(/^(?:sms|aws-sms):/i, "");
  if (!trimmed) {
    return "";
  }
  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return withPlus.replace(/[^\d+]/g, "");
}

export function looksLikeAwsSmsPhoneNumber(raw: string): boolean {
  const normalized = normalizeAwsSmsPhoneNumber(raw);
  return /^\+[1-9]\d{6,14}$/.test(normalized);
}

export function normalizeAwsSmsAllowFrom(raw: string): string {
  if (raw.trim() === "*") {
    return "*";
  }
  return normalizeAwsSmsPhoneNumber(raw).toLowerCase();
}
