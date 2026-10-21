// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import rehypeInlineDiagrams from './plugins/rehype-inline-diagrams.mjs';

export default defineConfig({
  site: 'https://blog.stormlantern.nl',
  output: 'static',
  build: { format: 'directory' },
  markdown: {
    rehypePlugins: [rehypeInlineDiagrams],
  },
  integrations: [
    expressiveCode({
      themes: ['github-light', 'github-dark'],
      themeCssSelector: (theme) =>
        theme.name === 'github-dark' ? '[data-theme="dark"]' : '[data-theme="light"]',
      styleOverrides: {
        borderRadius: 'var(--sl-radius-md)',
        codeFontFamily: 'var(--sl-font-family-mono)',
      },
    }),
    mdx(),
    sitemap(),
  ],
});
