/**
 * Fixed permission catalog, rank-derived defaults, and the pure can() helper.
 *
 * This module is CLIENT-SAFE: zero node: imports, zero database access.
 * All symbols are pure and hermetic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The fixed vocabulary of platform permissions. */
export type Permission =
  | 'course.create'
  | 'course.edit'
  | 'course.delete'
  | 'course.publish'
  | 'classroom.chat'
  | 'quiz.grade'
  | 'tts.use'
  | 'asr.use'
  | 'settings.manage'
  | 'users.manage'
  | 'roles.manage';

/**
 * Minimal principal shape for permission checks. The rank field maps to
 * the role rank defined in lib/auth/roles.ts. Anonymous users are
 * represented by a null principal.
 */
export interface Principal {
  readonly rank: number;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * The fixed, exhaustive permission vocabulary. Eleven entries verified
 * against the capability matrix. Frozen to prevent runtime mutation.
 */
export const PERMISSION_CATALOG: readonly Permission[] = Object.freeze([
  'course.create',
  'course.edit',
  'course.delete',
  'course.publish',
  'classroom.chat',
  'quiz.grade',
  'tts.use',
  'asr.use',
  'settings.manage',
  'users.manage',
  'roles.manage',
]) as readonly Permission[];

// ---------------------------------------------------------------------------
// Rank-derived defaults
// ---------------------------------------------------------------------------

/**
 * Returns the default permission set for a given rank. Anonymous (0) gets
 * nothing. Guest (1) gets quiz.grade. Learner (2) adds classroom.chat,
 * tts.use, asr.use. Creator (3) adds course.create/edit/delete/publish.
 * Admin (4) gets all eleven. Unknown ranks above the maximum return empty.
 */
export function defaultPermissionsForRank(rank: number): Permission[] {
  switch (rank) {
    case 1:
      return ['quiz.grade'];
    case 2:
      return ['quiz.grade', 'classroom.chat', 'tts.use', 'asr.use'];
    case 3:
      return [
        'quiz.grade',
        'classroom.chat',
        'tts.use',
        'asr.use',
        'course.create',
        'course.edit',
        'course.delete',
        'course.publish',
      ];
    case 4:
      return [...PERMISSION_CATALOG];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

/**
 * Pure permission check. Returns true when the principal holds the
 * requested permission after applying rank defaults and any caller
 * overrides.
 *
 * Anonymous principals (null) are denied everything regardless of
 * overrides. Override booleans override the rank default for a single
 * permission key.
 */
export function can(
  principal: Principal | null,
  permission: Permission,
  overrides?: ReadonlyMap<Permission, boolean>,
): boolean {
  if (!principal || principal.rank === 0) return false;

  const defaults = defaultPermissionsForRank(principal.rank);
  const allowed = new Set(defaults);

  if (overrides) {
    for (const [key, granted] of overrides) {
      if (granted) {
        allowed.add(key);
      } else {
        allowed.delete(key);
      }
    }
  }

  return allowed.has(permission);
}
