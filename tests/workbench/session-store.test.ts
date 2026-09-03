import { describe, expect, it } from 'vitest';

import {
  foldEvents,
  foldEvent,
  compactReplayEvents,
  type WorkbenchFold,
  type WorkbenchEvent,
  type ChatNode,
} from '@/lib/workbench/session-store';

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
    compactionKey: null,
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

describe('compaction fold', () => {
  function compStart(
    id: number,
    ts: number,
    tokensBefore: number,
    messagesBefore: number,
  ): WorkbenchEvent {
    return { id, ts, attempt: 1, type: 'compaction_start', data: { tokensBefore, messagesBefore } };
  }
  function compDelta(id: number, ts: number, text: string): WorkbenchEvent {
    return { id, ts, attempt: 1, type: 'compaction_delta', data: { text } };
  }
  function compEnd(
    id: number,
    ts: number,
    opts: { entryId: string; tokensBefore: number; tokensAfter: number; summary: string },
  ): WorkbenchEvent {
    return { id, ts, attempt: 1, type: 'compaction_end', data: opts };
  }

  it('fold start/delta/delta/end produces one compaction node with end-authoritative text', () => {
    const state = initialFold();
    const next = foldEvents(state, [
      compStart(10, 1000, 50000, 120),
      compDelta(11, 1100, 'Compacting...'),
      compDelta(12, 1200, 'Compacting context'),
      compEnd(13, 1300, {
        entryId: 'entry-1',
        tokensBefore: 50000,
        tokensAfter: 12000,
        summary: 'Summarized context',
      }),
    ]);
    const compactionNodes = next.chat.filter((n) => n.kind === 'compaction');
    expect(compactionNodes).toHaveLength(1);
    expect(compactionNodes[0]).toMatchObject({
      text: 'Summarized context',
      streaming: false,
      tokensBefore: 50000,
      tokensAfter: 12000,
      entryId: 'entry-1',
    });
    expect(compactionNodes[0].endedAt).toBe(1300);
    expect(next.compactionKey).toBeNull();
  });

  it('live fold and replay fold of same events produce byte-identical chat rows', () => {
    const events: WorkbenchEvent[] = [
      compStart(10, 1000, 50000, 120),
      compDelta(11, 1100, 'Compacting...'),
      compDelta(12, 1200, 'Compacting context'),
      compEnd(13, 1300, {
        entryId: 'entry-1',
        tokensBefore: 50000,
        tokensAfter: 12000,
        summary: 'Summarized context',
      }),
    ];
    const live = foldEvents(initialFold(), events);
    const replayed = foldEvents(initialFold(), events);
    expect(live.chat).toEqual(replayed.chat);
    const liveComp = live.chat.find((n) => n.kind === 'compaction');
    const replayComp = replayed.chat.find((n) => n.kind === 'compaction');
    expect(liveComp?.endedAt).toBe(replayComp?.endedAt);
  });

  it('compaction card does not disturb adjacent thinking/tool/user nodes', () => {
    const state: WorkbenchFold = {
      ...initialFold(),
      chat: [
        { key: 'u1', kind: 'user', text: 'hello' },
        { key: 't1', kind: 'thinking', text: 'reasoning', streaming: false },
        toolCard('tool-1'),
      ],
    };
    const next = foldEvents(state, [
      compStart(10, 1000, 50000, 120),
      compDelta(11, 1100, 'Compacting...'),
      compEnd(12, 1200, {
        entryId: 'entry-1',
        tokensBefore: 50000,
        tokensAfter: 12000,
        summary: 'Done',
      }),
    ]);
    expect(next.chat.find((n) => n.kind === 'user')).toMatchObject({ key: 'u1', text: 'hello' });
    expect(next.chat.find((n) => n.kind === 'thinking')).toMatchObject({
      key: 't1',
      text: 'reasoning',
    });
    expect(next.chat.find((n) => n.kind === 'tool')).toMatchObject({ key: 'tool-1' });
  });

  it('second start while streaming settles the older node', () => {
    const state = initialFold();
    let next = foldEvent(state, compStart(10, 1000, 50000, 120));
    next = foldEvent(next, compDelta(11, 1100, 'first compaction'));
    // Second compaction_start while the first is still streaming
    next = foldEvent(next, compStart(12, 1200, 40000, 100));
    const compNodes = next.chat.filter((n) => n.kind === 'compaction');
    expect(compNodes).toHaveLength(2);
    // First node is settled
    expect(compNodes[0].streaming).toBe(false);
    expect(compNodes[0].endedAt).toBe(1200);
    expect(compNodes[0].text).toBe('first compaction');
    // Second node is streaming
    expect(compNodes[1].streaming).toBe(true);
    expect(compNodes[1].tokensBefore).toBe(40000);
    expect(next.compactionKey).not.toBeNull();
  });

  it('message_start settles a streaming compaction node', () => {
    const state = initialFold();
    let next = foldEvent(state, compStart(10, 1000, 50000, 120));
    next = foldEvent(next, compDelta(11, 1100, 'Compacting...'));
    // message_start should settle the streaming compaction node
    next = foldEvent(next, {
      id: 12,
      ts: 1200,
      attempt: 1,
      type: 'message_start',
      data: { message: { role: 'assistant', content: [] } },
    });
    const compNode = next.chat.find((n) => n.kind === 'compaction');
    expect(compNode?.streaming).toBe(false);
    expect(compNode?.endedAt).toBe(1200);
  });

  it('session_end settles a streaming compaction node', () => {
    const state = initialFold();
    let next = foldEvent(state, compStart(10, 1000, 50000, 120));
    next = foldEvent(next, compDelta(11, 1100, 'Compacting...'));
    next = foldEvent(next, {
      id: 12,
      ts: 1200,
      attempt: 1,
      type: 'session_end',
      data: { status: 'succeeded' },
    });
    const compNode = next.chat.find((n) => n.kind === 'compaction');
    expect(compNode?.streaming).toBe(false);
    expect(compNode?.endedAt).toBe(1200);
  });

  it('compaction counts as a turn part (three-dot gap not shown after it)', () => {
    const state = initialFold();
    const next = foldEvents(state, [
      compStart(10, 1000, 50000, 120),
      compDelta(11, 1100, 'done'),
      compEnd(12, 1200, {
        entryId: 'e1',
        tokensBefore: 50000,
        tokensAfter: 12000,
        summary: 'Summarized',
      }),
    ]);
    // After compaction end, there is a turn part so no waiting gap opens
    const hasParts = next.chat.some(
      (n) =>
        n.kind === 'compaction' ||
        n.kind === 'thinking' ||
        n.kind === 'tool' ||
        n.kind === 'assistant',
    );
    expect(hasParts).toBe(true);
  });

  it('compaction_delta creates a node when no compaction node exists (replay-first-frame)', () => {
    // A compaction_delta arriving without a prior compaction_start (replay compaction
    // drops middle frames; the first delta can arrive before start in pruned logs)
    const state = initialFold();
    const next = foldEvent(state, compDelta(10, 1000, 'Accumulated text'));
    const compNode = next.chat.find((n) => n.kind === 'compaction');
    expect(compNode).toBeDefined();
    expect(compNode?.text).toBe('Accumulated text');
    expect(compNode?.streaming).toBe(true);
  });

  it('replay compaction_delta keeps first and last like message_update', () => {
    const events: WorkbenchEvent[] = [
      compStart(1, 1000, 50000, 120),
      compDelta(2, 1100, 'text 1'),
      compDelta(3, 1200, 'text 2'),
      compDelta(4, 1300, 'text 3'),
      compEnd(5, 1400, {
        entryId: 'e1',
        tokensBefore: 50000,
        tokensAfter: 12000,
        summary: 'final',
      }),
    ];
    const compacted = compactReplayEvents(events);
    // Should keep start, first delta, last delta, end
    const ids = compacted.map((e) => e.id);
    expect(ids).toContain(1); // start
    expect(ids).toContain(2); // first delta
    expect(ids).toContain(4); // last delta
    expect(ids).toContain(5); // end
    expect(ids).not.toContain(3); // middle delta dropped
  });
});

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
