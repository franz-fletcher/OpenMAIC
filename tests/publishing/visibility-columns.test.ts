import { describe, it, expect } from 'vitest';
import { STAGE_META_SCHEMA } from '@/lib/persistence/stage-meta';

describe('publishing visibility columns', () => {
  it('STAGE_META_SCHEMA contains status and audience ALTER statements', () => {
    const schema = STAGE_META_SCHEMA;
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'");
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS audience INTEGER NOT NULL DEFAULT 3');
  });

  it('STAGE_META_SCHEMA contains the guarded backfill UPDATE', () => {
    const schema = STAGE_META_SCHEMA;
    expect(schema).toContain(
      "UPDATE stage_meta SET status = 'published', audience = 0 WHERE is_public = true AND status = 'draft'",
    );
  });

  it('STAGE_META_SCHEMA contains the gallery partial index', () => {
    const schema = STAGE_META_SCHEMA;
    expect(schema).toContain('stage_meta_published_audience_idx');
    expect(schema).toContain("WHERE status = 'published' AND deleted_at IS NULL");
  });
});
