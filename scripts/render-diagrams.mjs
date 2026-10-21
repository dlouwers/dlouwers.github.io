// Pre-render all D2 sources in src/diagrams/ to SVG in public/img/diagrams/.
// We render at author time and commit the SVGs because doing this through a
// remark plugin at astro build time hangs CI (the @terrastruct/d2 WASM worker
// keeps the GHA runner's build process from exiting — see
// withastro/astro#8483, oven-sh/bun#8816).
//
// Colours come from the design system, not from D2 (design system #38). The
// diagram is rendered with one D2 theme, and recolorD2Svg rewrites D2's colour
// slots to var(--sl-color-diagram-*). Inlined into the page by
// plugins/rehype-inline-diagrams.mjs, those follow the light/dark theme like
// every other token, so no dark copy of the colours is needed.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { D2 } from '@terrastruct/d2';
import { recolorD2Svg } from '@dlouwers/stormlantern-tokens/d2';

const SRC = 'src/diagrams';
const OUT = 'public/img/diagrams';
const THEME = 0; // D2 "neutral default"; only its slot classes matter after recolouring
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
    darkThemeID: undefined,
    pad: PAD,
    noXMLTag: true,
  });
  const svg = recolorD2Svg(toSvgString(raw));
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
