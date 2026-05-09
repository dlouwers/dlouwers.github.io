import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft))
    .sort((a, b) => +b.data.date - +a.data.date);

  return rss({
    title: 'Dirk Louwers',
    description: 'Notes on software, systems, and finance tooling.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      link: `/posts/${post.id}/`,
      categories: post.data.tags,
    })),
  });
}
