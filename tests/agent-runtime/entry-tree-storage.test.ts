import {
  InMemorySessionRepo,
  SessionError,
  type AgentMessage,
  type SessionTreeEntry,
} from '@earendil-works/pi-agent-core';
import {
  PgAgentSessionStore,
  ensureAgentSessionSchema,
  type Queryable,
  type WithTransaction,
} from '@openmaic/storage/agent-session/pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  loadSessionEntryHistory,
  AgentSessionEntryStorage,
} from '@/lib/server/agent-runtime/entry-tree-storage';

const contractUrl = process.env.PG_CONTRACT_URL;

function transactionFor(pool: Pool): WithTransaction {
  return async <T>(body: (queryable: Queryable) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

describe.skipIf(!contractUrl)('AgentSessionEntryStorage with PostgreSQL 16', () => {
  let pool: Pool;
  let store: PgAgentSessionStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: contractUrl });
    await ensureAgentSessionSchema(pool);
    store = new PgAgentSessionStore(pool, { withTransaction: transactionFor(pool) });
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE agent_owner_session_events, agent_owner_session_event_counters, ' +
        'agent_session_entries, agent_session_events, agent_sessions CASCADE',
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('delegates append and path reads to an opened package tree', async () => {
    const session = await store.createSession({
      id: 'adapter-round-trip',
      ownerId: 'anon:test-owner',
      prompt: 'Build a concise lesson.',
    });
    const claim = await store.claimNextSession('worker-a', 101, {
      leaseTtlMs: 10_000,
      maxAttempts: 5,
      sessionId: session.id,
    });
    expect(claim).not.toBeNull();
    const tree = await store.openEntryTree(session.id, 'worker-a', claim!.attempt);
    const storage = AgentSessionEntryStorage.fromHandle(session, tree);
    const first: SessionTreeEntry = {
      type: 'message',
      id: 'entry-one',
      parentId: null,
      timestamp: '2026-08-24T00:00:00.000Z',
      message: { role: 'user', content: 'Start.', timestamp: 1 },
    };
    const second: SessionTreeEntry = {
      type: 'message',
      id: 'entry-two',
      parentId: first.id,
      timestamp: '2026-08-24T00:00:01.000Z',
      message: { role: 'user', content: 'Continue.', timestamp: 2 },
    };

    await storage.appendEntry(first);
    await storage.appendEntry(second);

    await expect(storage.getPathToRoot(second.id)).resolves.toEqual([first, second]);
    await expect(storage.getMetadata()).resolves.toEqual({
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
    });
  });

  it('translates a superseded package lease fence into a pi SessionError', async () => {
    const session = await store.createSession({
      id: 'adapter-lease-loss',
      ownerId: 'anon:test-owner',
      prompt: 'Resume safely.',
    });
    const firstClaim = await store.claimNextSession('worker-a', 101, {
      leaseTtlMs: 10_000,
      maxAttempts: 5,
      sessionId: session.id,
    });
    const staleTree = await store.openEntryTree(session.id, 'worker-a', firstClaim!.attempt);
    const storage = AgentSessionEntryStorage.fromHandle(session, staleTree);
    await store.finishSession(session.id, 'worker-a', { status: 'failed' });
    await store.requeueForRetry(session.id);
    const nextClaim = await store.claimNextSession('worker-b', 202, {
      leaseTtlMs: 10_000,
      maxAttempts: 5,
      sessionId: session.id,
    });
    expect(nextClaim?.attempt).toBe(firstClaim!.attempt + 1);

    const append = storage.appendEntry({
      type: 'message',
      id: 'stale-entry',
      parentId: null,
      timestamp: '2026-08-24T00:00:00.000Z',
      message: { role: 'user', content: 'Do not persist.', timestamp: 1 },
    });

    await expect(append).rejects.toMatchObject({
      name: 'SessionError',
      code: 'storage',
      cause: { name: 'AgentSessionLeaseLostError' },
    } satisfies Partial<SessionError>);
    await expect(staleTree.getEntries()).resolves.toEqual([]);
  });

  it('maps a missing referenced entry to not_found and a corrupt tree to invalid_session', async () => {
    const session = await store.createSession({
      id: 'adapter-code-mapping',
      ownerId: 'anon:test-owner',
      prompt: 'Distinguish error codes.',
    });
    const claim = await store.claimNextSession('worker-a', 101, {
      leaseTtlMs: 10_000,
      maxAttempts: 5,
      sessionId: session.id,
    });
    expect(claim).not.toBeNull();
    const tree = await store.openEntryTree(session.id, 'worker-a', claim!.attempt);
    const storage = AgentSessionEntryStorage.fromHandle(session, tree);
    const root: SessionTreeEntry = {
      type: 'message',
      id: 'code-map-root',
      parentId: null,
      timestamp: '2026-08-24T00:00:00.000Z',
      message: { role: 'user', content: 'Start.', timestamp: 1 },
    };
    await storage.appendEntry(root);

    // A caller-referenced entry that is not in the tree is not_found...
    await expect(storage.setLeafId('missing-target')).rejects.toMatchObject({
      name: 'SessionError',
      code: 'not_found',
    });
    await expect(storage.getPathToRoot('missing-leaf')).rejects.toMatchObject({
      name: 'SessionError',
      code: 'not_found',
    });

    // ...while a tree whose own leaf pointer dangles is invalid_session.
    await storage.appendEntry({
      type: 'leaf',
      id: 'code-map-leaf',
      parentId: root.id,
      timestamp: '2026-08-24T00:00:01.000Z',
      targetId: 'ghost-leaf',
    });
    await expect(storage.getLeafId()).rejects.toMatchObject({
      name: 'SessionError',
      code: 'invalid_session',
    });
  });
});

// ---------------------------------------------------------------------------
// Hermetic compaction round-trip (no PG required)
// ---------------------------------------------------------------------------

describe('loadSessionEntryHistory compaction round-trip', () => {
  function msg(text: string, role = 'user'): AgentMessage {
    return { role, content: [{ type: 'text', text }] } as unknown as AgentMessage;
  }

  it('writes a compaction entry and reloads it with summary plus kept tail', async () => {
    const repo = new InMemorySessionRepo();
    const session = await repo.create({ id: 'compaction-round-trip' });

    // Append 4 messages.
    await session.appendMessage(msg('first'));
    await session.appendMessage(msg('second'));
    await session.appendMessage(msg('third'));
    await session.appendMessage(msg('fourth'));

    const branch = await session.getBranch();
    expect(branch).toHaveLength(4);

    // Compaction entry: firstKeptEntryId = branch[2].id (third message).
    const firstKeptId = branch[2]!.id;
    await session.appendCompaction('Summary of first two messages', firstKeptId, 500);

    const history = await loadSessionEntryHistory(session, {
      sessionId: 'compaction-round-trip',
      hasPriorRun: true,
    });

    // Context view: summary message + third + fourth = 3 messages.
    expect(history.messages).toHaveLength(3);
    expect(history.messages[0]!.role).toBe('compactionSummary');

    // Cursor messages stay the full raw stream (4 messages).
    expect(history.cursorMessages).toHaveLength(4);
  });

  it('rejects a non-backward firstKeptEntryId', async () => {
    const repo = new InMemorySessionRepo();
    const session = await repo.create({ id: 'compaction-bad-keep' });

    await session.appendMessage(msg('one'));
    await session.appendMessage(msg('two'));

    const branch = await session.getBranch();
    // Insert a compaction whose firstKeptEntryId points to an entry
    // that does NOT appear in the branch path (forward reference).
    await session.appendCompaction('bad', 'non-existent-entry-id', 100);

    await expect(
      loadSessionEntryHistory(session, {
        sessionId: 'compaction-bad-keep',
        hasPriorRun: true,
      }),
    ).rejects.toMatchObject({
      name: 'SessionEntryHistoryError',
    });
  });

  it('rejects an empty tree after a prior run', async () => {
    const repo = new InMemorySessionRepo();
    const session = await repo.create({ id: 'compaction-empty-after-run' });

    await expect(
      loadSessionEntryHistory(session, {
        sessionId: 'compaction-empty-after-run',
        hasPriorRun: true,
      }),
    ).rejects.toMatchObject({
      name: 'SessionEntryHistoryError',
    });
  });

  it('returns empty arrays for a fresh session with no prior run', async () => {
    const repo = new InMemorySessionRepo();
    const session = await repo.create({ id: 'compaction-fresh' });

    const history = await loadSessionEntryHistory(session, {
      sessionId: 'compaction-fresh',
      hasPriorRun: false,
    });

    expect(history.messages).toEqual([]);
    expect(history.cursorMessages).toEqual([]);
    expect(history.branch).toEqual([]);
    expect(history.contextEntryIds).toEqual([]);
  });
});
