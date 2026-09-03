import { describe, expect, it } from 'vitest';
import { deriveToolProgress, progressLine } from '@/components/workbench/chat/tool-progress';

describe('deriveToolProgress', () => {
  it('starts generate_scene on 锁定页面', () => {
    const p = deriveToolProgress({
      toolName: 'generate_scene',
      traces: [],
      running: true,
      failed: false,
    });
    expect(p?.steps.map((s) => s.state)).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(p?.caption).toContain('对齐');
  });

  it('advances generate_scene through content then actions', () => {
    const mid = deriveToolProgress({
      toolName: 'generate_scene',
      traces: ['page 2 "折射": generating content'],
      running: true,
      failed: false,
    });
    expect(mid?.steps.map((s) => `${s.id}:${s.state}`)).toEqual([
      'prep:done',
      'content:active',
      'actions:pending',
      'save:pending',
    ]);

    const later = deriveToolProgress({
      toolName: 'generate_scene',
      traces: [
        'page 2 "折射": generating content',
        'llm[scene-content:slide]: … 12s',
        'page 2 "折射": generating actions',
      ],
      running: true,
      failed: false,
    });
    expect(later?.steps.find((s) => s.state === 'active')?.id).toBe('actions');
    expect(later?.caption).toContain('动作');
  });

  it('marks every generate_scene step done when the call finishes', () => {
    const p = deriveToolProgress({
      toolName: 'generate_scene',
      traces: ['page 2 "折射": generating actions'],
      running: false,
      failed: false,
    });
    expect(p?.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('returns null for tools without a generation pipeline', () => {
    expect(
      deriveToolProgress({ toolName: 'list_scenes', traces: [], running: true, failed: false }),
    ).toBeNull();
  });

  it('advances through generate_scene phase content vocabulary', () => {
    const mid = deriveToolProgress({
      toolName: 'generate_scene',
      traces: ['generate_scene phase content start'],
      running: true,
      failed: false,
    });
    expect(mid?.steps.map((s) => `${s.id}:${s.state}`)).toEqual([
      'prep:done',
      'content:active',
      'actions:pending',
      'save:pending',
    ]);
  });

  it('advances through generate_scene phase actions vocabulary', () => {
    const later = deriveToolProgress({
      toolName: 'generate_scene',
      traces: [
        'generate_scene phase content start',
        'generate_scene phase content done',
        'generate_scene phase actions start',
      ],
      running: true,
      failed: false,
    });
    expect(later?.steps.find((s) => s.state === 'active')?.id).toBe('actions');
  });

  it('advances to save when generate_scene phase persist is present', () => {
    const done = deriveToolProgress({
      toolName: 'generate_scene',
      traces: [
        'generate_scene phase content start',
        'generate_scene phase content done',
        'generate_scene phase actions start',
        'generate_scene phase actions done',
        'generate_scene phase persist',
      ],
      running: true,
      failed: false,
    });
    expect(done?.steps.find((s) => s.state === 'active')?.id).toBe('save');
  });

  it('exposes the active step as the one-line bar tick', () => {
    const start = deriveToolProgress({
      toolName: 'generate_scene',
      traces: [],
      running: true,
      failed: false,
    });
    expect(start && progressLine(start)).toBe('锁定页面');

    const mid = deriveToolProgress({
      toolName: 'generate_scene',
      traces: ['page 2 "折射": generating content'],
      running: true,
      failed: false,
    });
    expect(mid && progressLine(mid)).toBe('写内容');
  });
});
