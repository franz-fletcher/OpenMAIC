import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Protocol pin tests for qwen-token-plan-tts (slice S4, hermetic half).
 *
 * These tests record the exact frame sequence and payload field names the
 * vendor token-plan protocol requires, as observed in the live probes:
 * run-task -> task-started -> continue-task(input.text) -> finish-task ->
 * binary audio -> task-finished. Any client change that renames a field,
 * reorders a frame, or starts trusting a text frame for audio breaks a pin
 * here on purpose.
 *
 * The fake WebSocket harness lives in helpers/qwen-tp-fake-ws.ts. The S2
 * suite keeps its own inline copy untouched so gate G2.1 stays stable.
 */
vi.mock('undici', async () => {
  const helper = await import('./helpers/qwen-tp-fake-ws');
  return { WebSocket: helper.FakeWebSocket };
});

import {
  fakeWsState,
  resetFakeWs,
  scriptSuccess,
  sentActions,
  sentFrames,
  type FakeWebSocket,
} from './helpers/qwen-tp-fake-ws';
import {
  generateQwenTokenPlanTTS,
  QwenTokenPlanTTSError,
  __resetPoolForTests,
} from '@/lib/audio/qwen-token-plan-ws';

const PLUS_MODEL = 'qwen-audio-3.0-tts-plus';

const CONFIG = {
  providerId: 'qwen-token-plan-tts',
  apiKey: 'sk-pin',
  baseUrl: 'wss://pin.example/api-ws/v1/inference',
  modelId: PLUS_MODEL,
  voice: 'longanlingxin',
} as const;

function lastSocket(): FakeWebSocket {
  const ws = fakeWsState.instances.at(-1);
  if (!ws) throw new Error('The client opened no socket.');
  return ws;
}

describe('qwen-token-plan-tts protocol pin', () => {
  beforeEach(() => {
    resetFakeWs();
    __resetPoolForTests();
  });

  it('sends run-task, continue-task, finish-task in that order on one task_id', async () => {
    fakeWsState.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, '你好');

    const frames = sentFrames(lastSocket());
    expect(sentActions(lastSocket())).toEqual(['run-task', 'continue-task', 'finish-task']);
    const taskId = frames[0].header?.task_id;
    expect(taskId).toMatch(/^[0-9a-f]{32}$/);
    for (const frame of frames) {
      // All three frames carry the same task id and duplex streaming.
      expect(frame.header?.task_id).toBe(taskId);
      expect(frame.header?.streaming).toBe('duplex');
    }
  });

  it('pins the run-task frame: exact header and payload field sets', async () => {
    fakeWsState.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, '你好');

    const runTask = sentFrames(lastSocket())[0];
    expect(Object.keys(runTask.header ?? {}).sort()).toEqual(['action', 'streaming', 'task_id']);
    expect(runTask.header?.action).toBe('run-task');
    expect(Object.keys(runTask.payload ?? {}).sort()).toEqual([
      'function',
      'input',
      'model',
      'parameters',
      'task',
      'task_group',
    ]);
    expect(runTask.payload?.task_group).toBe('audio');
    expect(runTask.payload?.task).toBe('tts');
    expect(runTask.payload?.function).toBe('SpeechSynthesizer');
    expect(runTask.payload?.model).toBe(PLUS_MODEL);
    expect(Object.keys(runTask.payload?.parameters ?? {}).sort()).toEqual([
      'format',
      'pitch',
      'rate',
      'sample_rate',
      'text_type',
      'voice',
      'volume',
    ]);
    expect(runTask.payload?.parameters).toEqual({
      text_type: 'PlainText',
      voice: 'longanlingxin',
      format: 'mp3',
      sample_rate: 22050,
      volume: 50,
      rate: 1,
      pitch: 1,
    });
    expect(runTask.payload?.input).toEqual({});
  });

  it('pins continue-task: the text travels only in payload.input.text', async () => {
    fakeWsState.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, 'hello world');

    const continueTask = sentFrames(lastSocket())[1];
    expect(continueTask.header?.action).toBe('continue-task');
    expect(Object.keys(continueTask.payload ?? {})).toEqual(['input']);
    expect(Object.keys(continueTask.payload?.input ?? {})).toEqual(['text']);
    expect(continueTask.payload?.input?.text).toBe('hello world');
  });

  it('pins finish-task: header action with an empty input payload', async () => {
    fakeWsState.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, '你好');

    const finishTask = sentFrames(lastSocket())[2];
    expect(finishTask.header?.action).toBe('finish-task');
    expect(Object.keys(finishTask.payload ?? {})).toEqual(['input']);
    expect(finishTask.payload?.input).toEqual({});
  });

  it('waits for the task-started event before sending continue-task', async () => {
    // The ack is held back by hand, so the test can observe the client idling
    // after run-task. The vendor ignores text sent before task-started, so a
    // client that raced ahead would produce silent failures in production.
    let releaseAck: (() => void) | undefined;
    fakeWsState.onSend = (ws, data) => {
      const action = (JSON.parse(data) as { header?: { action?: string; task_id?: string } }).header
        ?.action;
      if (action === 'run-task') {
        releaseAck = () =>
          ws.emit('message', { data: JSON.stringify({ header: { event: 'task-started' } }) });
      } else if (action === 'finish-task') {
        queueMicrotask(() =>
          ws.emit('message', { data: JSON.stringify({ header: { event: 'task-finished' } }) }),
        );
      }
    };

    const task = generateQwenTokenPlanTTS(CONFIG, '你好');
    // Wait until run-task is on the wire, then confirm the client idles:
    // no continue-task without the task-started event.
    await vi.waitFor(() =>
      expect(sentActions(fakeWsState.instances[0] as FakeWebSocket)).toEqual(['run-task']),
    );
    expect(sentActions(fakeWsState.instances[0] as FakeWebSocket)).toEqual(['run-task']);

    releaseAck?.();
    await task;
    expect(sentActions(fakeWsState.instances[0] as FakeWebSocket)).toEqual([
      'run-task',
      'continue-task',
      'finish-task',
    ]);
  });

  it('accumulates audio from binary frames only, in receive order', async () => {
    // Text frames that look like audio must never contribute bytes. The
    // result-generated JSON below carries a fake base64 field for exactly
    // that reason.
    fakeWsState.onSend = (ws, data) => {
      const msg = JSON.parse(data) as { header?: { action?: string } };
      const action = msg.header?.action;
      if (action === 'run-task') {
        queueMicrotask(() =>
          ws.emit('message', { data: JSON.stringify({ header: { event: 'task-started' } }) }),
        );
      } else if (action === 'continue-task') {
        queueMicrotask(() => {
          ws.emit('message', { data: new Uint8Array([10, 11]) });
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'result-generated' },
              payload: { audio: 'AAECAwQF' },
            }),
          });
        });
      } else if (action === 'finish-task') {
        queueMicrotask(() => {
          ws.emit('message', { data: new Uint8Array([12, 13, 14]) });
          ws.emit('message', { data: JSON.stringify({ header: { event: 'task-finished' } }) });
        });
      }
    };

    const result = await generateQwenTokenPlanTTS(CONFIG, '你好');

    expect(result.format).toBe('mp3');
    // Exactly the two binary chunks, concatenated, nothing from the JSON.
    expect(Array.from(result.audio)).toEqual([10, 11, 12, 13, 14]);
  });

  it('pins a fresh task_id per task when the connection is reused', async () => {
    fakeWsState.onSend = scriptSuccess;

    await generateQwenTokenPlanTTS(CONFIG, 'first');
    await generateQwenTokenPlanTTS(CONFIG, 'second');

    // Same pooled socket serves both tasks.
    expect(fakeWsState.instances.length).toBe(1);
    const frames = sentFrames(fakeWsState.instances[0]);
    expect(sentActions(fakeWsState.instances[0])).toEqual([
      'run-task',
      'continue-task',
      'finish-task',
      'run-task',
      'continue-task',
      'finish-task',
    ]);
    const ids = frames
      .filter((f) => f.header?.action === 'run-task')
      .map((f) => f.header?.task_id ?? '');
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('pins the task-failed surface: header event, payload error fields', async () => {
    fakeWsState.onSend = (ws, data) => {
      const action = (JSON.parse(data) as { header?: { action?: string } }).header?.action;
      if (action === 'run-task') {
        queueMicrotask(() =>
          ws.emit('message', { data: JSON.stringify({ header: { event: 'task-started' } }) }),
        );
      } else if (action === 'finish-task') {
        queueMicrotask(() =>
          ws.emit('message', {
            data: JSON.stringify({
              header: { event: 'task-failed' },
              payload: { error_code: 'InvalidParameter', error_message: 'voice not found' },
            }),
          }),
        );
      }
    };

    const err = await generateQwenTokenPlanTTS(CONFIG, '你好').catch((e) => e);

    expect(err).toBeInstanceOf(QwenTokenPlanTTSError);
    expect((err as QwenTokenPlanTTSError).errorCode).toBe('InvalidParameter');
    expect((err as QwenTokenPlanTTSError).errorMessage).toBe('voice not found');
  });
});
