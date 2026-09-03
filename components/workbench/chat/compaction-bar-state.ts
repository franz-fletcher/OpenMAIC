'use client';

/**
 * Collapse logic for the compaction bar, kept out of the component so it can be
 * unit-tested without a DOM. Mirrors thinking-bar-state.ts structure closely.
 *
 * The bar is ALWAYS collapsed on first render, and nothing except a click may
 * open or close it — a compaction finishing must not yank the panel shut under
 * a reader who just opened it.
 */
import { useCallback, useState } from 'react';
import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';

/** Header text: activity while compacting, token label when done, plain done otherwise. */
export function compactionBarSummary(
  {
    streaming,
    before,
    after,
  }: {
    streaming: boolean;
    before?: string;
    after?: string;
  },
  t: WorkbenchTranslator = defaultWorkbenchTranslator,
): string {
  if (streaming) return t('workbench.compaction.active');
  if (before && after) return t('workbench.compaction.doneWithTokens', { before, after });
  return t('workbench.compaction.done');
}

const PREVIEW_MAX = 200;

/**
 * The one-line peek shown on the collapsed bar. Last nonempty line capped at
 * 200 chars, same algorithm as thinkingBarPreview.
 */
export function compactionBarPreview(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX)}…` : line;
  }
  return '';
}

export function useCompactionBar(): { expanded: boolean; toggle: () => void } {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);
  return { expanded, toggle };
}
