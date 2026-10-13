// Records how Chrome sizes a multi-line Edit, the oracle
// test/heights.test.jsx checks ren-dom and the canvases against: for each
// case (a font and line height passed down, an autosize, a style with
// paddings, borders and heights, a value of one line or seven), the
// textarea's height in Chrome under an application root, and the inline
// heights and paddings ren-dom wrote for it (the test checks ren-dom still
// writes them, so the heights are still ren-dom's).
// Run it under the machine-wide Chrome lock and commit what it writes:
//   flock "$HOME/.cache/chrome-bench.lock" node scripts/heights-oracle.mjs test/fixtures/heights.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { withChrome } from '../node_modules/ren-canv/scripts/chrome.mjs';

const SEVEN = 'a\nb\nc\nd\ne\nf\ng';
const fonts = [{}, { fontSize: 10, lineHeight: 2 }, { fontSize: 24, lineHeight: 1.25 }, { fontSize: 13, lineHeight: 1 }];
const sizes = [4, true, false];
const styles = [{}, { padding: 20 }, { padding: [20, 10, 0, 10] }, { border: 6 }, { maxHeight: 80 }, { height: 90 }, { minHeight: 100 }, { padding: 15, maxHeight: 80 }, { border: 4, minHeight: 30 }, { borderTop: 3, borderBottom: 0 }];
/** @type {{ font: object, autosize: number | boolean, style: object, value: string }[]} */
const cases = [];
for (const font of fonts) for (const autosize of sizes) for (const style of styles) for (const value of [SEVEN, 'a']) cases.push({ font, autosize, style, value });

/** The properties the test reads back. */
const INLINE = ['height', 'min-height', 'max-height', 'padding-top', 'padding-bottom', 'padding-block'];
const root = fileURLToPath(new URL('..', import.meta.url));
const page = `
import { Root, View, Edit } from 'ren-core';
import { $dom } from 'ren-dom';
const cases = ${JSON.stringify(cases)};
Root({ id: 'main', target: document.getElementById('c'), renderer: $dom(document), children: (
  <View style={{ width: 300 }}>
    {cases.map(c => <View style={{ height: 400, align: 'start', ...c.font }}><Edit lines={2} autosize={c.autosize} value={c.value} style={{ width: 200, ...c.style }} /></View>)}
  </View>
) });
window.sizes = () => [...document.querySelectorAll('textarea')].map(t => ({ height: t.getBoundingClientRect().height, inline: Object.fromEntries(${JSON.stringify(INLINE)}.map(p => [p, t.style.getPropertyValue(p)])) }));
`;
const bundle = await build({ stdin: { contents: page, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'ren-core', alias: { 'ren-dom': join(root, 'src/index.js') }, logLevel: 'error' });
const js = bundle.outputFiles[0].text;

await withChrome(async ({ send, evaluate, profile }) => {
  const file = join(profile, 'heights.html');
  writeFileSync(file, `<!doctype html><html><body style="margin:0"><div id=c></div><script>${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`);
  await send('Page.navigate', { url: `file://${file}` });
  // The page is loaded once its script has rendered (withChrome's deadline ends a page that never does).
  while ((await evaluate('typeof sizes === "function"')) !== true);
  const measured = await evaluate('sizes()');
  const recorded = await evaluate('navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0]');
  // A case a line; an inline property ren-dom left unset is left out.
  const rows = cases.map((c, i) => JSON.stringify({ ...c, height: measured[i].height, inline: Object.fromEntries(Object.entries(measured[i].inline).filter(e => e[1] !== '')) }));
  writeFileSync(process.argv[2], `{"recorded":${JSON.stringify(recorded)},"cases":[\n${rows.join(',\n')}\n]}\n`);
});
