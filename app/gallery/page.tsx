/**
 * Public gallery page — lists published courses visible to the viewer.
 *
 * Resolves the viewer rank from the request, queries the gallery index,
 * and renders each course as a card linking to `/classroom/[id]`.
 * Shows an empty state when no courses match the viewer rank.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { getStageAccessDb } from '@/lib/server/stage-access';
import { resolveViewerRank } from '@/lib/persistence/audience';
import { listGalleryCourses } from '@/lib/persistence/gallery';
import { getSession } from '@/lib/auth';
import { serverTranslate } from '@/lib/i18n/server-translate';
import { resolveServerLocale } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GalleryPage() {
  const db = await getStageAccessDb();
  const locale = await resolveServerLocale();

  // Resolve the viewer rank from the request session.
  const ownerId = await resolveOwnerId();
  const viewerRank = await resolveViewerRank(db, ownerId);
  const courses = await listGalleryCourses(db, viewerRank);

  return (
    <div className="min-h-[60vh] flex flex-col">
      <h1 className="text-2xl font-semibold mb-6">
        {await serverTranslate(locale, 'publishing.galleryTitle')}
      </h1>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground/60">
          <p>{await serverTranslate(locale, 'publishing.galleryEmpty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
          {courses.map((course) => (
            <Link
              key={course.stageId}
              href={`/classroom/${course.stageId}`}
              className="group cursor-pointer"
            >
              <div className="rounded-lg bg-muted/40 aspect-video mb-2 flex items-center justify-center text-muted-foreground/40 text-sm">
                {course.name}
              </div>
              <p className="text-sm font-medium truncate">{course.name}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

async function resolveOwnerId(): Promise<string> {
  const h = await headers();
  try {
    const session = await getSession(h);
    if (session) {
      return `user:${session.userId}`;
    }
  } catch {
    // Session lookup failed; fall through to anonymous.
  }

  const { resolveRequestOwnerId } = await import('@/lib/server/agent-runtime/owner');
  return resolveRequestOwnerId({ headers: h }, new Headers());
}
