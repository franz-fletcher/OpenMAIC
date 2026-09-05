import { describe, expect, it, vi } from 'vitest';

// Integration test — the real POST handler with mocked permission guard, LLM,
// and model resolver. The 403 path needs no LLM/model mocks.

const mocks = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockCallLLM: vi.fn(),
  mockResolveModel: vi.fn(),
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: (...args: unknown[]) => mocks.mockCallLLM(...args),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: (...args: unknown[]) => mocks.mockResolveModel(...args),
}));

vi.mock('@/lib/auth', () => ({
  requirePermission: (...args: unknown[]) => mocks.mockRequirePermission(...args),
}));

import { POST } from '@/app/api/quiz-grade/route';
import { NextRequest } from 'next/server';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/quiz-grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 403 path — guard denies before any LLM call
// ---------------------------------------------------------------------------

describe('quiz-grade 403 path', () => {
  it('returns 403 when guard throws permission_denied', async () => {
    const refusal = new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
    mocks.mockRequirePermission.mockRejectedValue(refusal);

    const req = makeRequest({
      question: 'What is 2+2?',
      userAnswer: '4',
      points: 10,
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('permission_denied');
    expect(body.message).toBe('permission denied');
    expect(mocks.mockCallLLM).not.toHaveBeenCalled();
    expect(mocks.mockResolveModel).not.toHaveBeenCalled();
  });

  it('does not call resolveModel before the guard', async () => {
    const refusal = new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403 },
    );
    mocks.mockRequirePermission.mockRejectedValue(refusal);

    const req = makeRequest({
      question: 'q',
      userAnswer: 'a',
      points: 5,
    });

    await POST(req);
    expect(mocks.mockResolveModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Allow path — guard passes, then LLM runs
// ---------------------------------------------------------------------------

describe('quiz-grade allow path', () => {
  it('passes guard then calls LLM and returns grade', async () => {
    const session = {
      id: 'sess-1',
      userId: 'user-1',
      token: 'tok',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };
    mocks.mockRequirePermission.mockResolvedValue(session);
    mocks.mockResolveModel.mockResolvedValue({
      model: 'gpt-4',
      thinkingConfig: undefined,
    });
    mocks.mockCallLLM.mockResolvedValue({
      text: '{"score": 8, "comment": "Good answer"}',
    });

    const req = makeRequest({
      question: 'What is 2+2?',
      userAnswer: '4',
      points: 10,
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.score).toBe(8);
    expect(body.comment).toBe('Good answer');
    expect(mocks.mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it('calls guard before resolveModel', async () => {
    const callOrder: string[] = [];
    const session = {
      id: 's',
      userId: 'u',
      token: 't',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };

    mocks.mockRequirePermission.mockImplementation(async () => {
      callOrder.push('guard');
      return session;
    });
    mocks.mockResolveModel.mockImplementation(async () => {
      callOrder.push('resolveModel');
      return { model: 'm', thinkingConfig: undefined };
    });
    mocks.mockCallLLM.mockImplementation(async () => {
      callOrder.push('callLLM');
      return { text: '{"score": 5, "comment": "ok"}' };
    });

    const req = makeRequest({ question: 'q', userAnswer: 'a', points: 10 });
    await POST(req);

    expect(callOrder).toEqual(['guard', 'resolveModel', 'callLLM']);
  });
});

// ---------------------------------------------------------------------------
// Guard runs before validation
// ---------------------------------------------------------------------------

describe('quiz-grade guard ordering', () => {
  it('guard returns 403 even for missing question', async () => {
    const refusal = new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403 },
    );
    mocks.mockRequirePermission.mockRejectedValue(refusal);

    const req = makeRequest({ userAnswer: 'a', points: 5 });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('guard returns 403 even for missing points', async () => {
    const refusal = new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403 },
    );
    mocks.mockRequirePermission.mockRejectedValue(refusal);

    const req = makeRequest({ question: 'q', userAnswer: 'a' });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
