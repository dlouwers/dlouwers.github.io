// Pre-render all D2 sources in src/diagrams/ to SVG in public/img/diagrams/.
// We render at author time and commit the SVGs because doing this through a
// remark plugin at astro build time hangs CI (the @terrastruct/d2 WASM worker
// keeps the GHA runner's build process from exiting — see
// withastro/astro#8483, oven-sh/bun#8816).
//
// The bridge from D2's `@media (prefers-color-scheme: dark)` to the site's
// `[data-theme="dark"]` toggle is applied to the rendered SVG too, so the
// dark-mode story stays the same as when the plugin ran inline.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { D2 } from '@terrastruct/d2';

const SRC = 'src/diagrams';
const OUT = 'public/img/diagrams';
const THEME = 0;       // light: D2 "neutral default"
const DARK_THEME = 200; // dark: D2 "dark mauve"
const PAD = 20;

const entries = (await readdir(SRC)).filter((f) => extname(f) === '.d2');
if (entries.length === 0) {
  console.log('No .d2 files in', SRC);
  process.exit(0);
}

await mkdir(OUT, { recursive: true });
const d2 = new D2();

for (const file of entries) {
  const inPath = join(SRC, file);
  const outPath = join(OUT, basename(file, '.d2') + '.svg');
  const source = await readFile(inPath, 'utf8');
  const compiled = await d2.compile(source);
  const raw = await d2.render(compiled.diagram, {
    ...compiled.renderOptions,
    themeID: THEME,
    darkThemeID: DARK_THEME,
    pad: PAD,
    noXMLTag: true,
  });
  const svg = bridgeDarkThemeToDataAttribute(toSvgString(raw));
  await writeFile(outPath, svg, 'utf8');
  console.log(`${inPath} -> ${outPath}`);
}

// Workers spawned by @terrastruct/d2 don't auto-terminate; force exit.
process.exit(0);

function toSvgString(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder('utf-8').decode(value);
  if (value && typeof value === 'object' && 'svg' in value) return toSvgString(value.svg);
  return String(value ?? '');
}

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
  return svg.slice(0, startMatch.index)
    + `@media screen and (prefers-color-scheme:dark){${guarded}}${explicit}`
    + svg.slice(closeIdx + 1);
}

function matchingClose(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function splitRules(body) {
  const rules = [];
  for (const chunk of body.split('}')) {
    const t = chunk.trim();
    if (!t) continue;
    const brace = t.indexOf('{');
    if (brace === -1) continue;
    rules.push({ sel: t.slice(0, brace).trim(), decl: t.slice(brace + 1) });
  }
  return rules;
}
