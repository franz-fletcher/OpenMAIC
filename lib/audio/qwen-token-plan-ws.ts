/**
 * Qwen Token Plan TTS over the DashScope WebSocket task protocol.
 *
 * The token plan serves this TTS model family only over WebSocket. The vendor
 * offers no HTTP TTS endpoint on the plan host. This module owns the frame
 * client, the typed errors, and the shared connection pool.
 *
 * Frame flow: the client sends run-task, waits for the task-started event,
 * then sends continue-task with the full text, then finish-task. The server
 * streams binary mp3 frames between control events and ends the task with
 * task-finished. A task-failed event carries the vendor error code.
 *
 * The socket comes from `undici`. The global WebSocket variant is stable only
 * from Node 22.4 while this repo allows Node >= 20.9, so the import avoids
 * that engines conflict. The init object carries the Authorization header.
 */

import { randomUUID } from 'crypto';
import { WebSocket } from 'undici';

import type { TTSModelConfig } from './types';
import { TTS_PROVIDERS } from './constants';
import {
  QwenTTSError,
  TTSRequestTimeoutError,
  ttsRequestSignal,
  type TTSGenerationResult,
} from './tts-providers';

/** Provider id used in error messages and by the registry lookup. */
const PROVIDER_ID = 'qwen-token-plan-tts';

/** Hard vendor bound for one continue-task text payload, in characters. */
const MAX_TEXT_LENGTH = 20_000;

/** Close a pooled connection after this much idle time. */
const IDLE_REAP_MS = 60_000;

/** Default number of pooled connections per endpoint and key. */
const DEFAULT_POOL_SIZE = 2;

/**
 * Thrown for qwen-token-plan-tts transport and protocol failures. Extends
 * `QwenTTSError` so the TTS route maps it through the existing
 * `instanceof QwenTTSError` branch without changes. The `errorCode` and
 * `errorMessage` fields carry the vendor values from a task-failed frame.
 */
export class QwenTokenPlanTTSError extends QwenTTSError {
  readonly errorCode?: string | number;
  readonly errorMessage?: string;

  constructor(
    message: string,
    httpStatus = 502,
    vendor?: { errorCode?: string | number; errorMessage?: string },
  ) {
    super(message, httpStatus);
    this.name = 'QwenTokenPlanTTSError';
    this.errorCode = vendor?.errorCode;
    this.errorMessage = vendor?.errorMessage;
  }
}

/** One decoded text frame from either side of the socket. */
interface DashScopeFrame {
  header?: {
    action?: string;
    event?: string;
    task_id?: string;
    streaming?: string;
    error_code?: string | number;
    error_message?: string;
  };
  payload?: {
    event?: string;
    error_code?: string | number;
    error_message?: string;
    task_group?: string;
    task?: string;
    function?: string;
    model?: string;
    parameters?: Record<string, unknown>;
    input?: unknown;
    [extra: string]: unknown;
  };
}

/** A caller waiting in the acquire queue for a free connection. */
interface PoolWaiter {
  resolve: (socket: WebSocket) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  detach: () => void;
}

/** Bookkeeping for one live pooled socket. */
interface PoolEntry {
  key: string;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** Per endpoint-and-key accounting. `live` counts leased plus idle sockets. */
interface PoolBucket {
  key: string;
  url: string;
  authorization: string;
  idle: WebSocket[];
  waiters: PoolWaiter[];
  live: number;
}

/** Pool size from the environment, falling back to the spec default of two. */
function resolvePoolSize(): number {
  const raw = process.env.OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_POOL_SIZE;
}

/** The standard cancellation error, mirroring what fetch produces. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Map a cancelled request signal to the repo-standard error. A per-request
 * timeout (reason `TimeoutError`, as set by `ttsRequestSignal`) becomes
 * `TTSRequestTimeoutError`. A caller cancel keeps its AbortError identity so
 * `generateTTS` can rethrow it unchanged.
 */
function timeoutOrAbortError(signal: AbortSignal): Error {
  const reason = signal.reason as { name?: string } | undefined;
  if (reason && reason.name === 'TimeoutError') {
    return new TTSRequestTimeoutError(
      PROVIDER_ID,
      `TTS request timed out (provider ${PROVIDER_ID}): the task did not finish within the request budget. Retry the request.`,
    );
  }
  return abortError(signal);
}

/** A fresh task id per task: 32 hex characters, as the plan expects. */
function newTaskId(): string {
  return randomUUID().replaceAll('-', '');
}

/** Normalise a binary WebSocket payload to bytes. */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  // Blob payloads never occur because the socket uses binaryType
  // 'arraybuffer'. Anything else is not audio and is ignored on purpose.
  return undefined;
}

/** Concatenate collected chunks preserving receive order. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Build the run-task frame with the fixed synthesis parameters. */
function buildRunTaskFrame(
  taskId: string,
  params: { model: string; voice: string; rate: number },
): DashScopeFrame {
  return {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: params.model,
      parameters: {
        text_type: 'PlainText',
        voice: params.voice,
        format: 'mp3',
        sample_rate: 22050,
        volume: 50,
        rate: params.rate,
        pitch: 1,
      },
      input: {},
    },
  };
}

/** Typed failure for a task-failed frame, carrying the vendor error fields. */
function taskFailedError(frame: DashScopeFrame): QwenTokenPlanTTSError {
  const errorCode = frame.header?.error_code ?? frame.payload?.error_code;
  const errorMessage =
    frame.header?.error_message ?? frame.payload?.error_message ?? 'unknown error';
  const codeText = errorCode === undefined ? 'unknown' : String(errorCode);
  return new QwenTokenPlanTTSError(
    `qwen-token-plan-tts task failed [${codeText}]: ${errorMessage}`,
    502,
    { errorCode, errorMessage },
  );
}

/** Wait until the socket opens. Transport errors and closes reject first. */
function waitForOpen(socket: WebSocket, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const settle = (fn: () => void): void => {
      if (done) return;
      done = true;
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onOpen = (): void => settle(resolve);
    const onError = (): void =>
      settle(() =>
        reject(new QwenTokenPlanTTSError('qwen-token-plan-tts WebSocket failed to connect.')),
      );
    const onClose = (): void =>
      settle(() =>
        reject(new QwenTokenPlanTTSError('qwen-token-plan-tts WebSocket closed before opening.')),
      );
    const onAbort = (): void => {
      settle(() => {
        try {
          socket.close();
        } catch {
          // Already closing. The caller-facing rejection is what matters.
        }
        reject(abortError(signal as AbortSignal));
      });
    };
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    }
  });
}

/**
 * Module-level connection pool for the token plan inference endpoint.
 *
 * Rules from the batch spec:
 * - The default size is two connections per endpoint and key. The
 *   `OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE` environment variable overrides it.
 * - One task runs on a connection at a time. `acquire` blocks while every
 *   connection is busy.
 * - `release` after task-finished keeps the socket for reuse. The next task
 *   supplies a fresh task id.
 * - `discard` after task-failed, a socket error, or an unexpected close
 *   removes the connection for good.
 * - Idle connections are reaped after 60 seconds.
 * - `shutdown` closes everything and rejects blocked acquires.
 */
export class QwenTokenPlanWsPool {
  private readonly size: number;
  private readonly idleTtlMs: number;
  private readonly buckets = new Map<string, PoolBucket>();
  private readonly entries = new Map<WebSocket, PoolEntry>();
  private shuttingDown = false;

  constructor(options: { size?: number; idleTtlMs?: number } = {}) {
    this.size = options.size ?? resolvePoolSize();
    this.idleTtlMs = options.idleTtlMs ?? IDLE_REAP_MS;
  }

  /**
   * Take an open connection for the endpoint, or block until one frees up.
   * Rejects with the standard AbortError when `signal` cancels the wait.
   */
  async acquire(options: {
    url: string;
    authorization: string;
    signal?: AbortSignal;
  }): Promise<WebSocket> {
    if (this.shuttingDown) {
      throw new Error('The qwen-token-plan-tts connection pool is shut down.');
    }
    const { url, authorization, signal } = options;
    if (signal?.aborted) {
      throw abortError(signal);
    }

    const key = `${url}\u0000${authorization}`;
    const bucket = this.bucketFor(key, url, authorization);

    // Reuse an idle connection when one exists for this endpoint and key.
    while (bucket.idle.length > 0) {
      const socket = bucket.idle.pop() as WebSocket;
      const entry = this.entries.get(socket);
      if (!entry) {
        // The peer closed it after parking. handleDeath already cleaned up.
        continue;
      }
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = undefined;
      }
      return socket;
    }

    // Open a fresh connection while under the size cap.
    if (bucket.live < this.size) {
      bucket.live += 1;
      return await this.openConnection(bucket, signal);
    }

    // The pool is full. Queue and wait for a release or a discard.
    return await new Promise<WebSocket>((resolve, reject) => {
      const waiter: PoolWaiter = { resolve, reject, settled: false, detach: () => {} };
      const onAbort = (): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        const index = bucket.waiters.indexOf(waiter);
        if (index >= 0) bucket.waiters.splice(index, 1);
        reject(abortError(signal as AbortSignal));
      };
      waiter.detach = (): void => {
        const index = bucket.waiters.indexOf(waiter);
        if (index >= 0) bucket.waiters.splice(index, 1);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      bucket.waiters.push(waiter);
    });
  }

  /**
   * Return a connection after task-finished. With a queued caller the socket
   * moves straight to that caller and stays leased. Without one it goes idle
   * and starts the 60-second reaper.
   */
  release(socket: WebSocket): void {
    const entry = this.entries.get(socket);
    if (!entry) {
      // The socket died during the task. There is nothing to return.
      return;
    }
    const bucket = this.buckets.get(entry.key);
    if (!bucket) return;

    const waiter = this.takeWaiter(bucket);
    if (waiter) {
      waiter.detach();
      waiter.settled = true;
      waiter.resolve(socket);
      return;
    }

    bucket.idle.push(socket);
    entry.idleTimer = setTimeout(() => {
      try {
        socket.close(1000, 'idle timeout');
      } catch {
        // Already closing. Clean up the bookkeeping either way.
      }
      this.handleDeath(socket);
    }, this.idleTtlMs);
    // Do not let an idle reaper keep a draining process alive.
    (entry.idleTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Permanently remove a connection after task-failed, a socket error, or an
   * unexpected close. A freed slot serves the next waiter immediately.
   */
  discard(socket: WebSocket): void {
    if (!this.entries.has(socket)) {
      // The persistent close handler already ran. Accounting is done.
      return;
    }
    this.handleDeath(socket);
    try {
      socket.close();
    } catch {
      // Already closing.
    }
  }

  /**
   * Drain the pool: close every connection, clear every reaper, and reject
   * callers still waiting. Wired into the server shutdown hooks from
   * instrumentation.ts.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const bucket of this.buckets.values()) {
      for (const waiter of bucket.waiters.splice(0)) {
        if (waiter.settled) continue;
        waiter.settled = true;
        waiter.detach();
        waiter.reject(
          new Error('The qwen-token-plan-tts connection pool shut down before a socket freed up.'),
        );
      }
    }
    for (const socket of [...this.entries.keys()]) {
      this.handleDeath(socket);
      try {
        socket.close(1001, 'server shutdown');
      } catch {
        // Already closing.
      }
    }
    this.buckets.clear();
  }

  private bucketFor(key: string, url: string, authorization: string): PoolBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { key, url, authorization, idle: [], waiters: [], live: 0 };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Create and open a socket. A failed open frees the slot for a waiter. */
  private async openConnection(bucket: PoolBucket, signal?: AbortSignal): Promise<WebSocket> {
    const socket = new WebSocket(bucket.url, {
      headers: { Authorization: bucket.authorization },
    });
    socket.binaryType = 'arraybuffer';
    this.entries.set(socket, { key: bucket.key });
    const deathListener = (): void => this.handleDeath(socket);
    socket.addEventListener('close', deathListener);
    try {
      await waitForOpen(socket, signal);
      return socket;
    } catch (error) {
      socket.removeEventListener('close', deathListener);
      this.handleDeath(socket);
      try {
        socket.close();
      } catch {
        // Already closing.
      }
      throw error;
    }
  }

  /** Remove a dead socket from accounting and let a freed slot serve waiters. */
  private handleDeath(socket: WebSocket): void {
    const entry = this.entries.get(socket);
    if (!entry) return;
    this.entries.delete(socket);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }
    const bucket = this.buckets.get(entry.key);
    if (!bucket) return;
    const index = bucket.idle.indexOf(socket);
    if (index >= 0) {
      bucket.idle.splice(index, 1);
    }
    bucket.live -= 1;
    this.serveWaiters(bucket);
  }

  /** Fill free slots with fresh connections for queued callers, FIFO order. */
  private serveWaiters(bucket: PoolBucket): void {
    while (bucket.live < this.size) {
      const waiter = this.takeWaiter(bucket);
      if (!waiter) return;
      bucket.live += 1;
      this.openConnection(bucket).then(
        (socket) => waiter.resolve(socket),
        (error) => waiter.reject(error),
      );
    }
  }

  private takeWaiter(bucket: PoolBucket): PoolWaiter | undefined {
    while (bucket.waiters.length > 0) {
      const waiter = bucket.waiters.shift() as PoolWaiter;
      if (!waiter.settled) {
        return waiter;
      }
    }
    return undefined;
  }
}

/**
 * Run one synthesis task on a leased socket. Sends run-task, waits for
 * task-started, then sends continue-task with the full text followed by
 * finish-task. Binary frames are collected in receive order. The promise
 * resolves with the complete mp3 bytes when task-finished arrives, and
 * rejects on task-failed, a transport error, an unexpected close, or the
 * request signal firing.
 */
function runSynthesisTask(
  socket: WebSocket,
  taskId: string,
  params: { model: string; voice: string; rate: number },
  text: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;

    const cleanup = (): void => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(concatBytes(chunks));
    };
    const sendFrame = (frame: DashScopeFrame): void => {
      socket.send(JSON.stringify(frame));
    };

    const onMessage = (event: { data?: unknown }): void => {
      const data = event.data;
      if (typeof data !== 'string') {
        const bytes = toBytes(data);
        if (bytes) {
          // Audio arrives as binary frames. Keep them in receive order.
          chunks.push(bytes);
        }
        return;
      }
      let frame: DashScopeFrame;
      try {
        frame = JSON.parse(data) as DashScopeFrame;
      } catch {
        // Non-JSON text is outside the protocol. Ignore it.
        return;
      }
      const eventName = frame.header?.event ?? frame.payload?.event;
      if (eventName === 'task-started') {
        try {
          sendFrame({
            header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: { text } },
          });
          sendFrame({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          });
        } catch {
          fail(new QwenTokenPlanTTSError('qwen-token-plan-tts WebSocket send failed.'));
        }
        return;
      }
      if (eventName === 'task-finished') {
        succeed();
        return;
      }
      if (eventName === 'task-failed') {
        fail(taskFailedError(frame));
        return;
      }
      // result-generated and unknown events are no-ops. The audio rides in
      // the binary frames between them.
    };
    const onClose = (): void => {
      fail(new QwenTokenPlanTTSError('qwen-token-plan-tts WebSocket closed before task-finished.'));
    };
    const onError = (): void => {
      fail(new QwenTokenPlanTTSError('qwen-token-plan-tts WebSocket reported a transport error.'));
    };
    const onAbort = (): void => {
      // Settle before closing. The close listener must not mask the
      // cancellation or timeout error with a generic close failure.
      fail(timeoutOrAbortError(signal));
      try {
        socket.close();
      } catch {
        // Already closing.
      }
    };

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });

    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      sendFrame(buildRunTaskFrame(taskId, params));
    } catch {
      fail(new QwenTokenPlanTTSError('qwen-token-plan-tts WebSocket send failed.'));
    }
  });
}

/**
 * Synthesize one text with the qwen-token-plan-tts provider.
 *
 * Resolves with the full mp3 body once the task reaches task-finished.
 * Rejects with `QwenTokenPlanTTSError` for protocol and transport failures,
 * with `TTSRequestTimeoutError` when the per-request budget elapses, and with
 * the standard AbortError when the caller cancels. `signal` is the merged
 * caller-cancel and timeout signal that `generateTTS` builds with
 * `ttsRequestSignal`. The same merged budget is applied again here so direct
 * callers keep the timeout guarantee.
 *
 * Text longer than 20000 characters is rejected before any socket opens.
 * Upstream splitting registers this bound in `TTS_MAX_TEXT_LENGTH`, so this
 * check is the last client-side guard.
 */
export async function generateQwenTokenPlanTTS(
  config: TTSModelConfig,
  text: string,
  signal?: AbortSignal,
): Promise<TTSGenerationResult> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new QwenTokenPlanTTSError(
      `qwen-token-plan-tts rejects text longer than ${MAX_TEXT_LENGTH} characters. Got ${text.length}. Split the text before synthesis.`,
    );
  }

  const registry = TTS_PROVIDERS[PROVIDER_ID];
  const url = config.baseUrl || registry.defaultBaseUrl;
  if (!url) {
    throw new QwenTokenPlanTTSError('qwen-token-plan-tts has no WebSocket endpoint configured.');
  }
  const model = config.modelId || registry.defaultModelId;
  if (!model) {
    throw new QwenTokenPlanTTSError('qwen-token-plan-tts has no model configured.');
  }

  const requestSignal = ttsRequestSignal(signal);
  const socket = await qwenTokenPlanWsPool.acquire({
    url,
    authorization: `Bearer ${config.apiKey ?? ''}`,
    signal: requestSignal,
  });
  try {
    const audio = await runSynthesisTask(
      socket,
      newTaskId(),
      { model, voice: config.voice, rate: config.speed ?? 1 },
      text,
      requestSignal,
    );
    qwenTokenPlanWsPool.release(socket);
    return { audio, format: 'mp3' };
  } catch (error) {
    qwenTokenPlanWsPool.discard(socket);
    throw error;
  }
}

/**
 * Process-wide pool singleton. Anchored on globalThis so a Next dev hot
 * reload keeps reusing the same pool instead of leaking an orphan socket set
 * per module re-evaluation.
 */
const globalSlot = globalThis as typeof globalThis & {
  __openmaicQwenTokenPlanWsPool?: QwenTokenPlanWsPool;
};

export let qwenTokenPlanWsPool: QwenTokenPlanWsPool =
  globalSlot.__openmaicQwenTokenPlanWsPool ?? new QwenTokenPlanWsPool();
globalSlot.__openmaicQwenTokenPlanWsPool = qwenTokenPlanWsPool;

/**
 * Replace the pool singleton with a fresh instance. Test-only hook. The TTS
 * code paths read the live binding, so the swap takes effect immediately.
 */
export function __resetPoolForTests(): void {
  void qwenTokenPlanWsPool.shutdown().catch(() => {
    // The old pool's rejections belong to no caller after a reset.
  });
  qwenTokenPlanWsPool = new QwenTokenPlanWsPool();
  globalSlot.__openmaicQwenTokenPlanWsPool = qwenTokenPlanWsPool;
}
