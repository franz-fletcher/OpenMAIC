/**
 * Map a pi tool_execution_update event to a trace message suitable for the
 * durable 'trace' lifecycle channel. Non-empty partialResult.message maps to
 * that message. Everything else maps to null.
 */
export function traceMessageForUpdate(update: {
  partialResult?: unknown;
}): { message: string } | null {
  if (
    update.partialResult &&
    typeof update.partialResult === 'object' &&
    !Array.isArray(update.partialResult)
  ) {
    const message = (update.partialResult as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length > 0) {
      return { message };
    }
  }
  return null;
}
