import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Gate tests for the qwen-token-plan-tts WebSocket provider (slice S2).
 *
 * The production client imports `WebSocket` from `undici`, so we mock the
 * `undici` module. Stubbing the global would NOT work. The fake records every
 * frame the client sends and lets each test script the server side of the
 * DashScope SpeechSynthesizer task protocol.
 */
const { FakeWebSocket } = vi.hoisted(() => {
  const instances: FakeWebSocket[] = [];

  /** Event object handed to message listeners. */
  interface FakeEvent {
    data?: unknown;
    [extra: string]: unknown;
  }
  /** Auth init the production client passes to the undici constructor. */
  interface FakeInit {
    headers?: Record<string, string>;
  }

  class FakeWebSocket {
    static instances = instances;
    /** When set, called for every frame the client sends. */
    static onSend: ((ws: FakeWebSocket, data: string) => void) | null = null;

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
      instances.push(this);
      // Simulate the socket opening on the next microtask.
      queueMicrotask(() => this.emit('open', {}));
    }

    send(data: string) {
      this.sent.push(data);
      FakeWebSocket.onSend?.(this, data);
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

  return { FakeWebSocket, instances };
});

/** Hoisted fake class seen by TS as a value, so derive the instance type. */
type FakeSocket = InstanceType<typeof FakeWebSocket>;
const instances: FakeSocket[] = FakeWebSocket.instances;

vi.mock('undici', () => ({ WebSocket: FakeWebSocket }));

import { generateTTS, QwenTTSError, TTSRequestTimeoutError } from '@/lib/audio/tts-providers';
import {
  generateQwenTokenPlanTTS,
  QwenTokenPlanTTSError,
  __resetPoolForTests,
} from '@/lib/audio/qwen-token-plan-ws';
import { TTS_MAX_TEXT_LENGTH } from '@/lib/audio/tts-utils';

const HELLO_BASE64 = Buffer.from([1, 2, 3, 4]).toString('base64');
const WORLD_BASE64 = Buffer.from([5, 6, 7, 8]).toString('base64');

const CONFIG = {
  providerId: 'qwen-token-plan-tts',
  apiKey: 'sk-test',
  voice: 'longanlingxin',
} as const;

/** Standard server script: ack run-task, then stream audio and finish. */
function scriptSuccess(ws: FakeSocket, data: string) {
  const msg = JSON.parse(data);
  const action = msg.header?.action;
  if (action === 'run-task') {
    queueMicrotask(() =>
      ws.emit('message', {
        data: JSON.stringify({ header: { event: 'task-started', task_id: msg.header.task_id } }),
      }),
    );
  } else if (action === 'continue-task') {
    queueMicrotask(() =>
      ws.emit('message', {
        data: JSON.stringify({
          header: { event: 'result-generated', task_id: msg.header.task_id },
          payload: { output: {} },
        }),
      }),
    );
  } else if (action === 'finish-task') {
    queueMicrotask(() => {
      ws.emit('message', { data: Buffer.from(HELLO_BASE64, 'base64') });
      ws.emit('message', {
        data: JSON.stringify({ header: { event: 'task-finished', task_id: msg.header.task_id } }),
      });
    });
  }
}

function parseSent(ws: FakeSocket) {
  return ws.sent.map((s) => JSON.parse(s));
}

function runTaskIds(ws: FakeSocket): string[] {
  return parseSent(ws)
    .filter((f) => f.header?.action === 'run-task')
    .map((f) => f.header.task_id);
}

describe('qwen-token-plan-tts', () => {
  beforeEach(() => {
    instances.length = 0;
    delete process.env.OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE;
    __resetPoolForTests();
    FakeWebSocket.onSend = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TTS_REQUEST_TIMEOUT_MS;
  });

  it('resolves concatenated mp3 bytes from the event/binary sequence', async () => {
    FakeWebSocket.onSend = (ws, data) => {
      const msg = JSON.parse(data);
      const action = msg.header?.action;
      if (action === 'run-task') {
        queueMicrotask(() =>
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-started', task_id: msg.header.task_id },
            }),
          }),
        );
      } else if (action === 'finish-task') {
        queueMicrotask(() => {
          // An unknown event must be treated as a no-op, not an error.
          ws.emit('message', {
            data: JSON.stringify({ header: { event: 'some-unknown-event', task_id: 'x' } }),
          });
          for (const b64 of [HELLO_BASE64, WORLD_BASE64]) {
            ws.emit('message', { data: Buffer.from(b64, 'base64') });
          }
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-finished', task_id: msg.header.task_id },
            }),
          });
        });
      }
    };

    const result = await generateQwenTokenPlanTTS(CONFIG, '你好世界');

    expect(result.format).toBe('mp3');
    expect(Array.from(result.audio)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('opens the pooled socket against the plan endpoint with bearer auth', async () => {
    FakeWebSocket.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, 'hi');

    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe(
      'wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference',
    );
    expect(instances[0].init.headers?.Authorization).toBe('Bearer sk-test');
  });

  it('sends run-task then continue-task then finish-task with the right parameters', async () => {
    FakeWebSocket.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(
      { ...CONFIG, modelId: 'qwen-audio-3.0-tts-plus', speed: 1.2 },
      'hello',
    );

    const frames = parseSent(instances[0]);
    expect(frames.map((f) => f.header?.action)).toEqual([
      'run-task',
      'continue-task',
      'finish-task',
    ]);

    const runTask = frames[0];
    expect(runTask.header.streaming).toBe('duplex');
    expect(runTask.header.task_id).toMatch(/^[0-9a-f]{32}$/);
    expect(frames[1].header.task_id).toBe(runTask.header.task_id);
    expect(frames[2].header.task_id).toBe(runTask.header.task_id);
    expect(runTask.payload.task_group).toBe('audio');
    expect(runTask.payload.task).toBe('tts');
    expect(runTask.payload.function).toBe('SpeechSynthesizer');
    expect(runTask.payload.model).toBe('qwen-audio-3.0-tts-plus');
    expect(runTask.payload.parameters).toMatchObject({
      text_type: 'PlainText',
      voice: 'longanlingxin',
      format: 'mp3',
      sample_rate: 22050,
      volume: 50,
      rate: 1.2,
      pitch: 1,
    });
    expect(runTask.payload.input).toEqual({});

    const continueTask = frames[1];
    expect(continueTask.payload.input.text).toBe('hello');

    // finish-task carries an empty input object.
    expect(frames[2].payload.input).toEqual({});
  });

  it('rejects text longer than 20000 chars without opening a socket', async () => {
    const longText = 'a'.repeat(20001);
    await expect(generateQwenTokenPlanTTS(CONFIG, longText)).rejects.toThrow(/20000/);
    expect(instances.length).toBe(0);
  });

  it('maps task-failed to a typed error extending QwenTTSError and discards the connection', async () => {
    FakeWebSocket.onSend = (ws, data) => {
      const msg = JSON.parse(data);
      if (msg.header?.action === 'run-task') {
        queueMicrotask(() =>
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-started', task_id: msg.header.task_id },
            }),
          }),
        );
      } else if (msg.header?.action === 'finish-task') {
        queueMicrotask(() =>
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-failed', task_id: msg.header.task_id },
              payload: { error_code: 49999, error_message: 'engine boom' },
            }),
          }),
        );
      }
    };

    await expect(generateQwenTokenPlanTTS(CONFIG, 'hi')).rejects.toThrow(/engine boom/);

    const err = await generateQwenTokenPlanTTS(CONFIG, 'hi').catch((e) => e);
    expect(err).toBeInstanceOf(QwenTTSError);
    expect(err).toBeInstanceOf(QwenTokenPlanTTSError);
    expect((err as QwenTokenPlanTTSError).errorCode).toBe(49999);
    expect((err as QwenTokenPlanTTSError).errorMessage).toBe('engine boom');
    expect((err as QwenTTSError).httpStatus).toBe(502);

    // The failed connection is discarded: a fresh socket is used next time.
    expect(instances.length).toBe(2);
    expect(instances[0].closed).toBe(true);
  });

  it('closes the socket and rejects when the caller aborts', async () => {
    const controller = new AbortController();
    FakeWebSocket.onSend = (ws, data) => {
      const msg = JSON.parse(data);
      if (msg.header?.action === 'run-task') {
        // Never respond. The caller aborts while we wait for task-started.
        queueMicrotask(() => controller.abort());
      }
    };

    const promise = generateQwenTokenPlanTTS(CONFIG, 'hi', controller.signal);

    await expect(promise).rejects.toThrow();
    expect(instances[0].closed).toBe(true);
  });

  it('maps a timeout to TTSRequestTimeoutError', async () => {
    process.env.TTS_REQUEST_TIMEOUT_MS = '50';
    FakeWebSocket.onSend = () => {
      // Never respond. The per-request timeout fires instead.
    };

    const promise = generateQwenTokenPlanTTS(CONFIG, 'hi');

    await expect(promise).rejects.toBeInstanceOf(TTSRequestTimeoutError);
    // A timed-out connection is discarded: the socket was closed.
    expect(instances[0].closed).toBe(true);
  });

  it('reuses a finished connection with a fresh task_id', async () => {
    FakeWebSocket.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, 'first');
    await generateQwenTokenPlanTTS(CONFIG, 'second');

    // Same socket instance for both tasks.
    expect(instances.length).toBe(1);
    expect(instances[0].closed).toBe(false);

    const ids = runTaskIds(instances[0]);
    expect(ids.length).toBe(2);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('makes a third concurrent synthesis wait for a free connection', async () => {
    // run-task acks are held back so the test controls task progress.
    const releaseStart: Array<() => void> = [];
    FakeWebSocket.onSend = (ws, data) => {
      const msg = JSON.parse(data);
      const action = msg.header?.action;
      if (action === 'run-task') {
        releaseStart.push(() =>
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-started', task_id: msg.header.task_id },
            }),
          }),
        );
      } else if (action === 'finish-task') {
        queueMicrotask(() => {
          ws.emit('message', { data: Buffer.from(HELLO_BASE64, 'base64') });
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-finished', task_id: msg.header.task_id },
            }),
          });
        });
      }
    };

    const first = generateQwenTokenPlanTTS(CONFIG, 'one');
    const second = generateQwenTokenPlanTTS(CONFIG, 'two');
    const third = generateQwenTokenPlanTTS(CONFIG, 'three');

    // The pool (default size 2) hands out exactly two sockets. The third
    // synthesis blocks before run-task: it owns no socket and sent nothing.
    await vi.waitFor(() => expect(releaseStart.length).toBe(2));
    expect(instances.length).toBe(2);
    expect(instances[2]).toBeUndefined();

    // Let the first two tasks finish. Each completion releases its socket,
    // and the waiting third synthesis takes over a released connection.
    releaseStart[0]!();
    await first;
    await vi.waitFor(() => expect(releaseStart.length).toBe(3));
    // No third socket was opened: the freed connection was reused.
    expect(instances.length).toBe(2);
    expect(runTaskIds(instances[0]).length + runTaskIds(instances[1]).length).toBe(3);

    releaseStart[1]!();
    releaseStart[2]!();
    await Promise.all([first, second, third]);
  });

  it('reaps idle connections after 60s', async () => {
    vi.useFakeTimers();

    FakeWebSocket.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, 'hi');
    expect(instances.length).toBe(1);
    expect(instances[0].closed).toBe(false);

    await vi.advanceTimersByTimeAsync(61_000);

    expect(instances[0].closed).toBe(true);
  });

  it('drops a connection closed by the peer and opens a fresh one next time', async () => {
    FakeWebSocket.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, 'hi');
    expect(instances.length).toBe(1);

    // Simulate the server closing the idle socket before the reaper fires.
    instances[0].emit('close', { code: 1006 });

    await generateQwenTokenPlanTTS(CONFIG, 'again');
    expect(instances.length).toBe(2);
  });

  it('respects OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE', async () => {
    process.env.OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE = '3';
    __resetPoolForTests();

    FakeWebSocket.onSend = scriptSuccess;

    const tasks = [
      generateQwenTokenPlanTTS(CONFIG, 'a'),
      generateQwenTokenPlanTTS(CONFIG, 'b'),
      generateQwenTokenPlanTTS(CONFIG, 'c'),
    ];

    // Three concurrent syntheses get three sockets under the env override.
    // With the default size of two, the third would still be waiting.
    await vi.waitFor(() => expect(instances.length).toBe(3));

    await Promise.all(tasks);
  });

  it('dispatches qwen-token-plan-tts through generateTTS', async () => {
    FakeWebSocket.onSend = scriptSuccess;

    const result = await generateTTS(CONFIG, 'via dispatch');

    expect(result.format).toBe('mp3');
    expect(Array.from(result.audio)).toEqual([1, 2, 3, 4]);
  });

  it('registers the 20000-char split limit for the new provider', () => {
    expect(TTS_MAX_TEXT_LENGTH['qwen-token-plan-tts']).toBe(20000);
  });
});
