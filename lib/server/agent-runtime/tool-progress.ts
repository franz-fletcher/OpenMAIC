/**
 * Shape of a pi tool_execution_update event that carries a message.
 * Used by traceMessageForUpdate to map updates onto the trace channel.
 */
export interface ToolUpdateWithMessage {
  partialResult?: unknown;
}

/**
 * Map a pi tool_execution_update event to a trace message suitable for the
 * durable 'trace' lifecycle channel. Non-empty partialResult.message maps to
 * that message. Everything else maps to null.
 */
export function traceMessageForUpdate(update: ToolUpdateWithMessage): { message: string } | null {
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
