// Inline pre-rendered D2 diagrams into the page at build time.
//
// Posts reference a diagram as <img src="/img/diagrams/<name>.svg" alt="" />
// inside a <figure class="d2-diagram">. As an <img>, the SVG is a separate
// document: its dark-mode rules, which are scoped under the page's <html>
// (see scripts/render-diagrams.mjs), can never match, so diagrams stayed
// light in dark mode. Inlined, the same rules follow both the OS setting and
// the site's theme toggle.
//
// No D2 runs at build time: the SVGs are rendered by `bun run render:diagrams`
// and committed. This only reads them.
//
// Runs before Astro's rehype-raw, so the figure blocks are still raw HTML
// strings here; the replacement is a string substitution inside them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIAGRAM_IMG = /<img\s+src="\/img\/diagrams\/([\w-]+)\.svg"[^>]*>/g;

export default function rehypeInlineDiagrams({ dir = 'public/img/diagrams' } = {}) {
  const cache = new Map();

  function svgFor(name) {
    if (!cache.has(name)) {
      // A missing file fails the build: a broken diagram should not ship.
      const raw = readFileSync(join(dir, `${name}.svg`), 'utf8');
      cache.set(name, decorate(raw));
    }
    return cache.get(name);
  }

  return (tree) => {
    walk(tree, (node) => {
      if (node.type === 'raw' && node.value.includes('/img/diagrams/')) {
        node.value = node.value.replace(DIAGRAM_IMG, (_, name) => svgFor(name));
      }
    });
  };
}

// The figure carries role="img" and the description, so the SVG itself is
// hidden from assistive tech. Width and height come from the viewBox, so the
// diagram renders at the size it was drawn at, and CSS scales it down.
function decorate(svg) {
  return svg.replace(/^<svg\b([^>]*)>/, (open, attrs) => {
    const vb = attrs.match(/viewBox="([-\d.\s]+)"/);
    const [, , w, h] = vb ? vb[1].trim().split(/\s+/) : [];
    const size = w && h && !/\swidth=/.test(attrs) ? ` width="${w}" height="${h}"` : '';
    return `<svg${attrs}${size} aria-hidden="true" focusable="false">`;
  });
}

function walk(node, visit) {
  visit(node);
  if (node.children) for (const child of node.children) walk(child, visit);
}
