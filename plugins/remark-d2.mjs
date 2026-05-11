import { visit } from 'unist-util-visit';
import { D2 } from '@terrastruct/d2';

let d2Instance;
const cache = new Map();

/**
 * Terminate the D2 worker. The @terrastruct/d2 package keeps a Node
 * `worker_threads.Worker` alive after compile/render and exposes no public
 * cleanup API, which keeps the process alive — locally bun reaps it on exit,
 * but in CI (GitHub Actions runner + bun) the build step hangs indefinitely.
 * Call this from an Astro `astro:build:done` integration hook.
 */
export async function disposeD2() {
  if (!d2Instance) return;
  try {
    await d2Instance.ready;
  } catch {}
  const worker = d2Instance.worker;
  d2Instance = undefined;
  if (worker && typeof worker.terminate === 'function') {
    try { await worker.terminate(); } catch {}
  }
}

export default function remarkD2(options = {}) {
  const { themeID = 0, darkThemeID = 200, pad = 20 } = options;

  return async function transformer(tree) {
    const targets = [];
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang === 'd2' && parent && typeof index === 'number') {
        targets.push({ node, index, parent });
      }
    });

    if (targets.length === 0) return;
    if (!d2Instance) d2Instance = new D2();

    for (const { node, index, parent } of targets) {
      const cacheKey = `${themeID}|${darkThemeID}|${pad}|${node.value}`;
      let svg = cache.get(cacheKey);
      if (!svg) {
        const compiled = await d2Instance.compile(node.value);
        const raw = await d2Instance.render(compiled.diagram, {
          ...compiled.renderOptions,
          themeID,
          darkThemeID,
          pad,
          noXMLTag: true,
        });
        svg = bridgeDarkThemeToDataAttribute(toSvgString(raw));
        cache.set(cacheKey, svg);
      }

      const caption = (node.meta || '').trim();
      const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
      const ariaLabel = caption ? ` aria-label="${escapeAttr(caption)}"` : '';

      parent.children[index] = {
        type: 'html',
        value: `<figure class="d2-diagram" role="img"${ariaLabel}>${svg}${figcaption}</figure>`,
      };
    }
  };
}

// The d2 render() API is typed as returning a Promise<string>, but in some
// runtimes (notably bun on the GitHub Actions runner) it comes back as a
// Uint8Array transferred over the worker message channel. Normalise to a
// string before any regex work, otherwise the build dies with
// "svg.match is not a function".
function toSvgString(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder('utf-8').decode(value);
  if (value && typeof value === 'object' && 'svg' in value) {
    return toSvgString(value.svg);
  }
  return String(value ?? '');
}

// D2's darkThemeID emits dark styles inside @media (prefers-color-scheme: dark).
// The site supports a manual theme toggle that sets data-theme="dark" / "light"
// on <html>. We rewrite the SVG so dark styles also apply under [data-theme="dark"]
// and so [data-theme="light"] forces light even when the OS reports dark.
function bridgeDarkThemeToDataAttribute(svg) {
  const startRe = /@media screen and \(prefers-color-scheme:\s*dark\)\s*\{/;
  const startMatch = svg.match(startRe);
  if (!startMatch) return svg;
  const openIdx = startMatch.index + startMatch[0].length - 1;
  const closeIdx = matchingClose(svg, openIdx);
  if (closeIdx === -1) return svg;

  const body = svg.slice(openIdx + 1, closeIdx);
  const rules = splitRules(body);
  if (rules.length === 0) return svg;

  const guarded = rules.map((r) => `:where(html:not([data-theme="light"])) ${r.sel}{${r.decl}}`).join('');
  const explicit = rules.map((r) => `:where(html[data-theme="dark"]) ${r.sel}{${r.decl}}`).join('');

  const before = svg.slice(0, startMatch.index);
  const after = svg.slice(closeIdx + 1);
  return `${before}@media screen and (prefers-color-scheme:dark){${guarded}}${explicit}${after}`;
}

function matchingClose(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitRules(body) {
  const rules = [];
  for (const chunk of body.split('}')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const brace = trimmed.indexOf('{');
    if (brace === -1) continue;
    rules.push({ sel: trimmed.slice(0, brace).trim(), decl: trimmed.slice(brace + 1) });
  }
  return rules;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
