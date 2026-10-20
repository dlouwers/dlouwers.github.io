import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/**
 * Build-time "now", captured once per process so every route in a single build
 * agrees on which posts are live, even if the build straddles a publish boundary.
 *
 * `BLOG_NOW` (ISO 8601) overrides the clock. It exists so the date gate can be
 * proven in a *real* production build — same command CI runs, no `--mode` games.
 * Nothing sets it in the deploy workflow; only the verification workflow does.
 */
function resolveNow(): Date {
  const override = import.meta.env.BLOG_NOW;
  if (override) {
    const parsed = new Date(override);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`BLOG_NOW is not a valid date: ${override}`);
    }
    return parsed;
  }
  return new Date();
}

const NOW = resolveNow();

/**
 * `astro dev` shows future-dated posts so a queued series can be proofread in
 * situ. Vite statically replaces `import.meta.env.DEV` with `false` in
 * `astro build`, so this branch is dead code in `dist/` — the one way to defeat
 * that is `astro build --mode development`, which is why `package.json`'s build
 * script must stay a bare `astro build`. Setting BLOG_NOW opts dev back into
 * real gating.
 */
const SHOW_FUTURE = import.meta.env.DEV && !import.meta.env.BLOG_NOW;

/** Not a draft, and its date has arrived. */
export function isPublished(post: Post, now: Date = NOW): boolean {
  if (post.data.draft) return false;
  if (SHOW_FUTURE) return true;
  return post.data.date.getTime() <= now.getTime();
}

/**
 * Newest first — the order every listing on the site uses. Posts on the same
 * date keep their file-name order, so a series published in one day reads
 * part 1, part 2 rather than whatever order the loader happened to return.
 */
export function byDateDesc(a: Post, b: Post): number {
  return +b.data.date - +a.data.date || a.id.localeCompare(b.id);
}

/**
 * The one source of truth for "which posts may the public see", sorted newest
 * first. Every listing, feed and route goes through here so the gate cannot be
 * forgotten at one call site.
 */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', (post) => isPublished(post));
  return posts.sort(byDateDesc);
}
