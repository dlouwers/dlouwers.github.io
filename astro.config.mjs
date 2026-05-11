// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import remarkD2, { disposeD2 } from './plugins/remark-d2.mjs';

// Tiny integration: terminate the D2 WASM worker once the build is done.
// Without this the worker keeps the Node event loop alive in CI and the
// astro build step hangs indefinitely.
const d2Cleanup = {
  name: 'd2-cleanup',
  hooks: {
    'astro:build:done': async () => {
      await disposeD2();
    },
  },
};

export default defineConfig({
  site: 'https://blog.stormlantern.nl',
  output: 'static',
  build: { format: 'directory' },
  markdown: {
    remarkPlugins: [[remarkD2, { themeID: 0, darkThemeID: 200 }]],
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
    d2Cleanup,
  ],
});
