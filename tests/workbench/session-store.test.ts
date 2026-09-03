import { describe, expect, it } from 'vitest';

import { foldEvents, type WorkbenchFold, type ChatNode } from '@/lib/workbench/session-store';

function toolCard(key: string): ChatNode {
  return {
    key,
    kind: 'tool',
    text: '',
    toolCallId: 'call-1',
    toolName: 'generate_scene',
    toolArgs: {},
    toolState: 'running',
  };
}

function initialFold(): WorkbenchFold {
  return {
    status: 'running',
    lastEventId: 0,
    error: null,
    courseTitle: null,
    sessionPrompt: null,
    sessionTitle: null,
    skillId: null,
    skillViolations: [],
    plan: [],
    pages: {},
    chat: [toolCard('tool-1')],
    runCourseStageIds: [],
    touchedStageIds: [],
    stageLinkStageIds: [],
    thinkingKey: null,
    assistantKey: null,
    generationOpen: false,
    waitingKey: null,
    waitingArmed: false,
    epoch: 0,
    libraryRevision: 0,
    generatingOrder: null,
    panelOpen: false,
    panelPinned: false,
    stageId: null,
    sessionTitleRevision: 0,
    replaying: false,
    replayedStageLinkCount: 0,
    attached: false,
    sessionId: null,
  } as WorkbenchFold;
}

function traceEvent(id: number, ts: number, message: string) {
  return {
    id,
    ts,
    attempt: 1,
    type: 'trace',
    data: { message },
  };
}

function toolStartEvent(id: number, ts: number, toolCallId: string, toolName: string) {
  return {
    id,
    ts,
    attempt: 1,
    type: 'tool_execution_start',
    data: { toolCallId, toolName, args: {} },
  };
}

describe('foldEvents', () => {
  it('trace: appends trace message to running tool card toolTraces ring', () => {
    const state = initialFold();

    const events = [
      toolStartEvent(1, 1, 'call-1', 'generate_scene'),
      traceEvent(2, 2, 'generate_scene phase content start'),
      traceEvent(3, 3, 'generate_scene phase content done'),
    ];

    const next = foldEvents(state, events);
    const toolNode = next.chat.find((n) => n.kind === 'tool' && n.toolCallId === 'call-1');
    expect(toolNode?.toolTraces).toEqual([
      'generate_scene phase content start',
      'generate_scene phase content done',
    ]);
  });

  it('trace: trims ring to TRACE_RING_MAX when overflow', () => {
    const state = initialFold();
    const events = [
      toolStartEvent(1, 1, 'call-1', 'generate_scene'),
      ...Array.from({ length: 202 }, (_, i) => traceEvent(i + 2, i + 2, `line-${i}`)),
    ];
    const next = foldEvents(state, events);
    const toolNode = next.chat.find((n) => n.kind === 'tool' && n.toolCallId === 'call-1');
    expect(toolNode?.toolTraces?.length).toBeLessThanOrEqual(200);
  });
});
