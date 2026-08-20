let counter = 0

/**
 * Distinct, well-formed value: `prefix-<pid%10000>-<unix ms>-<counter>` (the contract is
 * pinned by unique.spec.ts). Runs are serial (port-in-use guard), so the in-process counter
 * plus the millisecond timestamp give process-wide distinctness; `pid % 10000` keeps the
 * third legacy group while keeping values short — the label's 32 mm text column renders
 * single-word fields in full only up to ~29 chars at the 8 pt floor, and the label-text
 * tests match the full field strings.
 */
export function unique(prefix: string): string {
  return `${prefix}-${process.pid % 10000}-${Date.now()}-${counter++}`
}
