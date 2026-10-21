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
      // Code blocks sit on the design system's content panel (#38), the same
      // one diagrams use. The syntax colours stay with the GitHub themes.
      styleOverrides: {
        borderRadius: 'var(--sl-radius-panel)',
        borderColor: 'var(--sl-color-panel-border)',
        codeBackground: 'var(--sl-color-panel)',
        codeFontFamily: 'var(--sl-font-family-mono)',
        frames: {
          frameBoxShadowCssValue: 'var(--sl-shadow-panel)',
          editorBackground: 'var(--sl-color-panel)',
          terminalBackground: 'var(--sl-color-panel)',
        },
      },
    }),
    mdx(),
    sitemap(),
  ],
});
