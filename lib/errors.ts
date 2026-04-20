/**
 * Error types for the parsing / consolidation pipeline.
 * Parsers never throw — they return these in ParseResult.errors.
 * UI components consume these to display actionable messages.
 */

export class ParserDetectionError extends Error {
  constructor(
    public readonly filename: string,
    message: string
  ) {
    super(`[${filename}] Detection failed: ${message}`);
    this.name = 'ParserDetectionError';
  }
}

export class ChecksumMismatchError extends Error {
  constructor(
    public readonly broker: string,
    public readonly expected: number,
    public readonly actual: number,
    public readonly delta_pct: number
  ) {
    super(
      `[${broker}] Checksum mismatch: expected ${expected.toFixed(2)}, ` +
        `got ${actual.toFixed(2)} (delta ${delta_pct.toFixed(2)}%)`
    );
    this.name = 'ChecksumMismatchError';
  }
}

export class DuplicateAccountError extends Error {
  constructor(
    public readonly broker: string,
    public readonly cuenta: string,
    public readonly file1: string,
    public readonly file2: string
  ) {
    super(
      `[${broker}] Cuenta ${cuenta} aparece en dos archivos: ${file1} y ${file2}`
    );
    this.name = 'DuplicateAccountError';
  }
}

/**
 * Tolerance for checksum validation.
 * delta_pct > CHECKSUM_PCT_THRESHOLD OR delta_abs > CHECKSUM_ABS_THRESHOLD → error
 */
export const CHECKSUM_PCT_THRESHOLD = 0.5; // 0.5%
export const CHECKSUM_ABS_THRESHOLD = 100; // USD 100

export function isChecksumOk(expected: number, actual: number): boolean {
  if (expected === 0 && actual === 0) return true;
  const delta = Math.abs(expected - actual);
  const delta_pct = expected !== 0 ? (delta / Math.abs(expected)) * 100 : Infinity;
  return delta_pct <= CHECKSUM_PCT_THRESHOLD && delta <= CHECKSUM_ABS_THRESHOLD;
}
