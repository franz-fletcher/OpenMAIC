/**
 * Client-side quota exhaustion handling in quiz-view.tsx.
 *
 * Tests the `gradeShortAnswerQuestion` function (exported from the
 * quiz-view component file) for two paths:
 *
 * - 429 with `code: 'quota_exhausted'` -> returns a result with
 *   `quotaExhausted: true` and `earned: 0` (no half credit).
 * - Any other non-OK status -> falls through to the generic catch
 *   which gives half credit (existing behavior, byte-identical).
 *
 * Gate: QUIZ_CLIENT_OK
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { gradeShortAnswerQuestion } from '@/components/scene-renderers/quiz-view';

// Re-export the function so we can import it from tests.
// The component file exports it as a module-scoped function;
// we access it through the component's module namespace.

interface Question {
  id: string;
  question: string;
  points?: number;
  commentPrompt?: string;
  type: 'short_answer';
}

describe('gradeShortAnswerQuestion — quotaExhausted', () => {
  const originalFetch = globalThis.fetch;
  let mockResponse: Response | undefined;

  beforeEach(() => {
    mockResponse = undefined;
    globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
      if (mockResponse) return Promise.resolve(mockResponse);
      return originalFetch(url, init);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('429 with quota_exhausted code returns no half credit', async () => {
    mockResponse = new Response(
      JSON.stringify({ message: 'quiz grading quota exhausted', code: 'quota_exhausted' }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );

    const result = await gradeShortAnswerQuestion(
      { id: 'q1', question: 'Test', type: 'short_answer' } as Question,
      'My answer',
      'en-US',
    );

    expect(result.earned).toBe(0);
    expect(result.quotaExhausted).toBe(true);
  });

  it('429 without quota_exhausted code falls through to half credit', async () => {
    mockResponse = new Response(JSON.stringify({ message: 'rate limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });

    const result = await gradeShortAnswerQuestion(
      { id: 'q1', question: 'Test', type: 'short_answer' } as Question,
      'My answer',
      'en-US',
    );

    // 429 without code 'quota_exhausted' -> generic catch -> half credit
    expect(result.earned).toBe(1);
    expect(result.quotaExhausted).toBeUndefined();
  });

  it('500 returns half credit (unchanged)', async () => {
    mockResponse = new Response(JSON.stringify({ message: 'internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });

    const result = await gradeShortAnswerQuestion(
      { id: 'q1', question: 'Test', type: 'short_answer' } as Question,
      'My answer',
      'en-US',
    );

    expect(result.earned).toBe(1);
    expect(result.quotaExhausted).toBeUndefined();
  });

  it('200 returns normal grading result', async () => {
    mockResponse = new Response(JSON.stringify({ score: 1, comment: 'Great answer!' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const result = await gradeShortAnswerQuestion(
      { id: 'q1', question: 'Test', type: 'short_answer' } as Question,
      'My answer',
      'en-US',
    );

    expect(result.earned).toBe(1);
    expect(result.aiComment).toBe('Great answer!');
    expect(result.quotaExhausted).toBeUndefined();
  });
});
