import { describe, expect, it } from 'vitest';

import { traceMessageForUpdate } from '@/lib/server/agent-runtime/tool-progress';

describe('traceMessageForUpdate', () => {
  it('maps a tool_execution_update with non-empty partialResult.message to that message', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'generate_scene',
      args: {},
      partialResult: { message: 'generate_scene phase content start' },
    } as never;
    expect(traceMessageForUpdate(event)).toEqual({ message: 'generate_scene phase content start' });
  });

  it('returns null when partialResult is undefined', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'generate_scene',
      args: {},
    } as never;
    expect(traceMessageForUpdate(event)).toBeNull();
  });

  it('returns null when partialResult.message is empty string', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'generate_scene',
      args: {},
      partialResult: { message: '' },
    } as never;
    expect(traceMessageForUpdate(event)).toBeNull();
  });

  it('returns null when partialResult.message is missing', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'generate_scene',
      args: {},
      partialResult: { other: 'data' },
    } as never;
    expect(traceMessageForUpdate(event)).toBeNull();
  });

  it('returns null when partialResult is null', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'generate_scene',
      args: {},
      partialResult: null,
    } as never;
    expect(traceMessageForUpdate(event)).toBeNull();
  });

  it('returns null when partialResult is not an object', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'generate_scene',
      args: {},
      partialResult: 'not-an-object',
    } as never;
    expect(traceMessageForUpdate(event)).toBeNull();
  });
});
