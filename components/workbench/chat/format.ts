/** Shared small formatters for the workbench chat blocks. */

/**
 * A duration between two event timestamps. The workbench fold stores event
 * `ts` (numbers), not ISO strings, so this takes milliseconds directly.
 */
export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  const minutes = Math.floor(s / 60);
  const seconds = Math.round(s % 60);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

export function formatDurationBetween(startedAt?: number, endedAt?: number): string {
  if (startedAt === undefined || endedAt === undefined) return '';
  return formatDurationMs(endedAt - startedAt);
}

/**
 * Format a token count for display in compact bar labels.
 * Below 1000 renders raw. 1000-999999 renders as K. 1000000+ renders as M.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(tokens);
}
