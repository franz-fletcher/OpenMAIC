import { describe, expect, it } from 'vitest';
import {
  thinkingBarPreview,
  thinkingBarSummary,
} from '@/components/workbench/chat/thinking-bar-state';

describe('thinkingBarSummary', () => {
  it('says 思考中 while streaming and 已思考 once settled', () => {
    expect(thinkingBarSummary({ streaming: true })).toBe('思考中…');
    expect(thinkingBarSummary({ streaming: true, duration: '1.2s' })).toBe('思考中…');
    expect(thinkingBarSummary({ streaming: false, duration: '3.2s' })).toBe('已思考 3.2s');
    expect(thinkingBarSummary({ streaming: false })).toBe('已思考');
  });
});

describe('thinkingBarPreview', () => {
  it('uses the newest non-empty line', () => {
    expect(thinkingBarPreview('第一步\n第二步\n\n  \n')).toBe('第二步');
  });
});

import {
  compactionBarSummary,
  compactionBarPreview,
} from '@/components/workbench/chat/compaction-bar-state';
import { formatTokens } from '@/components/workbench/chat/format';
import { createWorkbenchTranslator } from '@/lib/i18n/workbench';

const en = createWorkbenchTranslator('en-US');

describe('compactionBarSummary', () => {
  it('returns running label while streaming', () => {
    expect(compactionBarSummary({ streaming: true }, en)).toBe('Compacting context...');
  });

  it('returns token label when both counts exist', () => {
    expect(compactionBarSummary({ streaming: false, before: '112K', after: '24K' }, en)).toBe(
      'Compacted 112K \u2192 24K',
    );
  });

  it('returns plain done when no counts', () => {
    expect(compactionBarSummary({ streaming: false }, en)).toBe('Compacted');
  });
});

describe('compactionBarPreview', () => {
  it('returns last nonempty line capped at 200 chars', () => {
    const longLine = 'A'.repeat(250);
    expect(compactionBarPreview(`first\n${longLine}\nlast`)).toBe('last');
    expect(compactionBarPreview(`first\n${longLine}`)).toBe('A'.repeat(200) + '…');
  });

  it('returns empty string for empty text', () => {
    expect(compactionBarPreview('')).toBe('');
  });
});

describe('formatTokens', () => {
  it('formats 112000 as 112K', () => {
    expect(formatTokens(112000)).toBe('112K');
  });

  it('formats 24000 as 24K', () => {
    expect(formatTokens(24000)).toBe('24K');
  });

  it('formats 1200000 as 1.2M', () => {
    expect(formatTokens(1200000)).toBe('1.2M');
  });

  it('formats 999 as 999', () => {
    expect(formatTokens(999)).toBe('999');
  });
});
