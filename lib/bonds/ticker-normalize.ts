export function normalizeBondTicker(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = raw.toUpperCase().trim();
  const parts = cleaned.match(/[A-Z0-9]+/g) ?? [];
  if (parts.length === 0) return '';
  const withDigits = parts.find((p) => /\d/.test(p));
  return withDigits ?? parts[0]!;
}

