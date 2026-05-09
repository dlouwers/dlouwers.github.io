// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';

export default defineConfig({
  site: 'https://blog.stormlantern.nl',
  output: 'static',
  build: { format: 'directory' },
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
