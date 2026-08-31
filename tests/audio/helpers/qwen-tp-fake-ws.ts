/**
 * Shared fake WebSocket harness for hermetic qwen-token-plan-tts tests.
 *
 * The production client imports `WebSocket` from `undici`, so test files mock
 * that module to the class below with `vi.mock('undici', ...)`. State lives on
 * `globalThis` so the mock factory and the test file always see the same
 * instance list, even if the module graph evaluates this file twice.
 *
 * The fake records every frame the client sends and lets each test script the
 * server side of the DashScope SpeechSynthesizer task protocol.
 */

/** Event object handed to message listeners. */
export interface FakeEvent {
  data?: unknown;
  [extra: string]: unknown;
}

/** Auth init the production client passes to the undici constructor. */
export interface FakeInit {
  headers?: Record<string, string>;
}

/** Shared mutable state, stored on globalThis for factory/test identity. */
export interface FakeWsState {
  instances: FakeWebSocket[];
  /** When set, called for every frame the client sends. */
  onSend: ((ws: FakeWebSocket, data: string) => void) | null;
}

const globalSlot = globalThis as typeof globalThis & {
  __qwenTpFakeWsState?: FakeWsState;
};

/** The one fake state this file exposes. Never recreate it. */
export const fakeWsState: FakeWsState = (globalSlot.__qwenTpFakeWsState ??= {
  instances: [],
  onSend: null,
});

/** In-memory WebSocket double with scripted server responses. */
export class FakeWebSocket {
  sent: string[] = [];
  closed = false;
  closeCode?: number;
  closeReason?: string;
  readyState = 1;
  binaryType = 'blob';
  url: string;
  init: FakeInit;
  private listeners: Record<string, Array<(ev: FakeEvent) => void>> = {};

  constructor(url: string, init?: FakeInit) {
    this.url = url;
    this.init = init ?? {};
    fakeWsState.instances.push(this);
    // Simulate the socket opening on the next microtask.
    queueMicrotask(() => this.emit('open', {}));
  }

  send(data: string) {
    this.sent.push(data);
    fakeWsState.onSend?.(this, data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  addEventListener(type: string, listener: (ev: FakeEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (ev: FakeEvent) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((l) => l !== listener);
  }

  emit(type: string, ev: FakeEvent) {
    const data = ev.data !== undefined ? ev.data : ev;
    (this.listeners[type] || []).forEach((l) => l({ data }));
  }
}

/** Forget every socket and hook. Call from `beforeEach`. */
export function resetFakeWs(): void {
  fakeWsState.instances.length = 0;
  fakeWsState.onSend = null;
}

/** Parsed shape of one client frame as it appears on the wire. */
export interface SentFrame {
  header?: { action?: string; task_id?: string; streaming?: string; event?: string };
  payload?: {
    task_group?: string;
    task?: string;
    function?: string;
    model?: string;
    parameters?: Record<string, unknown>;
    input?: { text?: string } & Record<string, unknown>;
  };
}

/** Parse all frames one socket has sent. */
export function sentFrames(ws: FakeWebSocket): SentFrame[] {
  return ws.sent.map((s) => JSON.parse(s) as SentFrame);
}

/** The header.action values in send order. */
export function sentActions(ws: FakeWebSocket): string[] {
  return sentFrames(ws).map((f) => f.header?.action ?? '');
}

/**
 * Standard success script: ack run-task with task-started, stream one binary
 * chunk and one result-generated event, then finish on finish-task.
 */
export function scriptSuccess(ws: FakeWebSocket, data: string): void {
  const msg = JSON.parse(data) as { header?: { action?: string; task_id?: string } };
  const action = msg.header?.action;
  if (action === 'run-task') {
    queueMicrotask(() =>
      ws.emit('message', {
        data: JSON.stringify({ header: { event: 'task-started', task_id: msg.header?.task_id } }),
      }),
    );
  } else if (action === 'continue-task') {
    queueMicrotask(() => {
      ws.emit('message', { data: new Uint8Array([1, 2, 3, 4]) });
      ws.emit('message', {
        data: JSON.stringify({
          header: { event: 'result-generated', task_id: msg.header?.task_id },
          payload: { output: {} },
        }),
      });
    });
  } else if (action === 'finish-task') {
    queueMicrotask(() => {
      ws.emit('message', { data: new Uint8Array([5, 6, 7, 8]) });
      ws.emit('message', {
        data: JSON.stringify({ header: { event: 'task-finished', task_id: msg.header?.task_id } }),
      });
    });
  }
}
