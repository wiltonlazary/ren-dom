// Checks an Edit's caretRow() in Chrome, where a textarea lays its value
// out: for each case (a text in a multi-line Edit of a width, in one font,
// with ren-dom's sheet), the row and row count caretRow() gives at every
// caret offset, against the rows Chrome wraps the value into, read from the
// boxes of each grapheme in a hidden copy of the field (as ren-canv's
// scripts/rows-oracle.mjs reads them), the caret at a wrap on the next row.
// It exits 1 on a difference. Run it under the machine-wide Chrome lock:
//   flock "$HOME/.cache/chrome-bench.lock" node scripts/caret-check.mjs
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { withChrome } from '../node_modules/ren-canv/scripts/chrome.mjs';

const FONT = '"DejaVu Sans Mono", monospace';
const cases = [
  { text: 'The quick brown fox jumps over the lazy dog and a supercalifragilisticexpialidocious word ends it here', width: 160, lines: 12 },
  { text: 'abcdefgh      ijkl mnop', width: 96, lines: 12 },
  { text: 'abcdefghi jklmnopqr stu', width: 96, lines: 12 },
  { text: 'one\n\ntwo three four five six\n', width: 96, lines: 12 },
  { text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen', width: 96, lines: 3 },
  { text: '', width: 96, lines: 2 },
];
const root = fileURLToPath(new URL('..', import.meta.url));
const page = `
import { Root, View, Edit } from 'ren-core';
import { $dom } from 'ren-dom';
const cases = ${JSON.stringify(cases)};
Root({ id: 'main', target: document.getElementById('c'), renderer: $dom(document), children: (
  <View style={{ fontFamily: ${JSON.stringify(FONT)}, fontSize: 16, lineHeight: 1.25 }}>
    {cases.map(c => <Edit lines={c.lines} value={c.text} style={{ width: c.width, padding: 0, border: 0 }} />)}
  </View>
) });
window.check = () => [...document.querySelectorAll('textarea')].map((t, i) => {
  const text = cases[i].text;
  // Chrome's rows: a hidden copy of the field's text box, each grapheme's box top.
  const copy = document.createElement('div');
  const css = getComputedStyle(t);
  copy.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;border:0;padding:0;';
  for (const name of ['font-family', 'font-size', 'line-height', 'letter-spacing', 'word-spacing', 'tab-size']) copy.style.setProperty(name, css.getPropertyValue(name));
  copy.style.width = t.clientWidth + 'px';
  copy.textContent = text + '\\u200b';
  document.body.appendChild(copy);
  const node = copy.firstChild;
  const top = copy.getBoundingClientRect().top;
  const line = parseFloat(css.lineHeight);
  const starts = [0];
  let row = 0;
  for (const g of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(copy.textContent)) {
    const r = document.createRange();
    r.setStart(node, g.index);
    r.setEnd(node, g.index + g.segment.length);
    const at = Math.round((r.getClientRects()[0].top - top) / line);
    if (at > row) { starts.push(g.index); row = at; }
  }
  copy.remove();
  const out = [];
  for (let at = 0; at <= text.length; at++) {
    t.setSelectionRange(at, at);
    const want = { row: starts.reduce((r, s, k) => (s <= at ? k : r), 0), rows: starts.length };
    const got = t.caretRow();
    if (got.row !== want.row || got.rows !== want.rows) out.push({ at, got, want });
  }
  return { text, rows: starts.length, wrong: out };
});
`;
const bundle = await build({ stdin: { contents: page, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'ren-core', alias: { 'ren-dom': join(root, 'src/index.js') }, logLevel: 'error' });
const js = bundle.outputFiles[0].text;

await withChrome(async ({ send, evaluate }) => {
  await send('Page.navigate', { url: 'data:text/html,<!doctype html><html lang="en"><body><div id="c"></div></body></html>' });
  while ((await evaluate('document.getElementById("c") !== null')) !== true);
  await evaluate(js);
  await evaluate('document.fonts.ready.then(() => true)');
  let failed = false;
  const results = /** @type {{ text: string, rows: number, wrong: any[] }[]} */ (await evaluate('check()'));
  for (const r of results) {
    console.log(`${r.wrong.length === 0 ? 'ok  ' : 'FAIL'} ${r.rows} rows: ${JSON.stringify(r.text.slice(0, 40))}`);
    for (const w of r.wrong) console.log(`     at ${w.at}: got ${JSON.stringify(w.got)}, Chrome ${JSON.stringify(w.want)}`);
    if (r.wrong.length > 0) failed = true;
  }
  // withChrome ends the process: 1 when this throws.
  if (failed) throw new Error('caretRow() differs from Chrome');
});
