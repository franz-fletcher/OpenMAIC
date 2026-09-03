'use client';

/**
 * Compaction bar — thinking-card shape with a Shrink icon. Collapsed by
 * default, one-line peek of the newest line, expand in place for the full
 * summary text. Status changes must not open or close it.
 */
import { ChevronDown, ChevronRight, Shrink } from 'lucide-react';

import { defaultWorkbenchTranslator, type WorkbenchTranslator } from '@/lib/i18n/workbench';
import type React from 'react';
import { wbStyles as styles } from './chat-styles';
import {
  compactionBarPreview,
  compactionBarSummary,
  useCompactionBar,
} from './compaction-bar-state';
import type { ToolStackPosition } from './tool-card';

// prettier-ignore
export function CompactionBlock(props: { text: string; streaming?: boolean; tokensBefore?: string; tokensAfter?: string; endedAt?: number; stackPosition?: ToolStackPosition; t?: WorkbenchTranslator }): React.JSX.Element | null {
  const {
    text,
    streaming = false,
    tokensBefore,
    tokensAfter,
    endedAt,
    stackPosition = 'single',
    t = defaultWorkbenchTranslator,
  } = props;
  const { expanded, toggle } = useCompactionBar();

  if (!text) return null;

  const summary = compactionBarSummary({ streaming, before: tokensBefore, after: tokensAfter }, t);
  const preview = compactionBarPreview(text);

  return (
    <div
      className={styles.thinking.box}
      data-open={expanded}
      data-stack={stackPosition}
      data-streaming={streaming || undefined}
      data-testid="workbench-compaction-bar"
    >
      <button
        type="button"
        className={styles.thinking.head}
        aria-expanded={expanded}
        aria-label={summary}
        onClick={toggle}
      >
        <span className={styles.thinking.icon} aria-hidden="true">
          <Shrink size={13} />
        </span>
        <span className={styles.thinking.text}>
          <span className={styles.thinking.name}>{summary}</span>
          {!expanded && preview ? (
            <span className={styles.thinking.arg} title={preview}>
              {preview}
            </span>
          ) : null}
        </span>
        <span className={styles.thinking.car} aria-hidden="true">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {expanded ? (
        <div className={styles.thinking.body}>
          <pre className={styles.thinking.detail}>{text}</pre>
        </div>
      ) : null}
    </div>
  );
}
