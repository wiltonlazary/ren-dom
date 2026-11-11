// Checks ren-core's focusables() in Chrome, where Tab decides: for each case
// (a piece of markup between two buttons), the elements focusables() lists
// below the case's box, against the elements Tab stops at on the way from
// the button before the box to the one after it, and Shift+Tab on the way
// back. The cases hold every edge the list knows: a disabled control, a
// hidden subtree, a negative tabindex, an inert region, a hidden input, a
// disabled fieldset with its first legend, hidden and collapsed visibility,
// editable elements and a details' summaries. It exits 1 on a difference.
// Run it under the machine-wide Chrome lock:
//   flock -w 1800 "$HOME/.cache/chrome-bench.lock" node scripts/focus-check.mjs
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withChrome } from '../node_modules/ren-canv/scripts/chrome.mjs';

const cases = [
  { name: 'disabled, hidden, negative tabindex, inert, hidden input',
    html: '<span>text</span><button id="off" disabled>x</button><input id="a"><div hidden><button id="hid">h</button></div><div tabindex="-1" id="out"></div><div inert><button id="inert">i</button><div tabindex="0" id="still"></div></div><div tabindex="0" id="region"></div><button id="b">b</button><input type="hidden" id="h" name="token">' },
  { name: 'a disabled fieldset, its first legend aside',
    html: '<fieldset disabled><legend><input id="legend"></legend><legend><input id="second"></legend><input id="field"><button id="press">x</button><select id="pick"></select><textarea id="area"></textarea>' +
      '<fieldset><input id="deep"></fieldset><a href="#" id="link">a</a><div tabindex="0" id="stop"></div></fieldset>' +
      '<fieldset><legend><fieldset disabled><input id="inner"></fieldset></legend><input id="free"></fieldset>' },
  { name: 'hidden and collapsed visibility',
    html: '<div style="visibility: hidden"><button id="unseen">v</button><button id="seen" style="visibility: visible">v</button></div><div style="visibility: collapse"><input id="collapsed"></div>' },
  { name: 'editable elements',
    html: '<div contenteditable id="edit">e</div><div contenteditable="true" id="edit2">e</div><div contenteditable="FALSE" id="fixed">e</div><div contenteditable tabindex="-1" id="skipped">e</div>' },
  { name: "a details' summaries",
    html: '<details><summary id="summary">s</summary><summary id="other">s</summary></details><summary id="loose">s</summary>' },
];
const root = fileURLToPath(new URL('..', import.meta.url));
const page = `
import { focusables } from 'ren-core/host';
const cases = ${JSON.stringify(cases)};
cases.forEach((c, i) => {
  const before = document.createElement('button');
  before.id = 'before' + i;
  const box = document.createElement('div');
  box.id = 'box' + i;
  box.innerHTML = c.html;
  const after = document.createElement('button');
  after.id = 'after' + i;
  document.body.append(before, box, after);
});
window.listed = i => focusables(document.getElementById('box' + i)).map(el => el.id);
window.start = id => (document.getElementById(id).focus(), document.activeElement.id);
window.at = () => document.activeElement?.id ?? '';
`;
const bundle = await build({ stdin: { contents: page, resolveDir: root, loader: 'js' }, bundle: true, write: false, format: 'iife', logLevel: 'error' });
const js = bundle.outputFiles[0].text;

await withChrome(async ({ send, evaluate }) => {
  await send('Page.navigate', { url: 'data:text/html,<!doctype html><html lang="en"><body></body></html>' });
  while ((await evaluate('document.body !== null && document.readyState === "complete"')) !== true);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await evaluate(js);
  /** One Tab press. @param {boolean} back */
  const tab = async back => {
    const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: back ? 8 : 0 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  /** The ids Tab stops at from one button to the other. @param {string} from @param {string} to @param {boolean} back */
  const walk = async (from, to, back) => {
    if ((await evaluate(`start(${JSON.stringify(from)})`)) !== from) throw new Error(`${from} did not take the focus`);
    /** @type {string[]} */
    const stops = [];
    for (let presses = 0; presses < 64; presses++) {
      await tab(back);
      const id = /** @type {string} */ (await evaluate('at()'));
      if (id === to) return stops;
      stops.push(id);
    }
    throw new Error(`Tab from ${from} never reached ${to}: ${stops.join()}`);
  };
  let failed = false;
  for (let i = 0; i < cases.length; i++) {
    const listed = /** @type {string[]} */ (await evaluate(`listed(${i})`));
    const forward = await walk(`before${i}`, `after${i}`, false);
    const backward = (await walk(`after${i}`, `before${i}`, true)).reverse();
    const same = listed.join() === forward.join() && listed.join() === backward.join();
    console.log(`${same ? 'ok  ' : 'FAIL'} ${cases[i].name}: ${listed.join() || '(none)'}`);
    if (!same) {
      console.log(`     Tab in Chrome: ${forward.join() || '(none)'}; Shift+Tab, reversed: ${backward.join() || '(none)'}`);
      failed = true;
    }
  }
  // withChrome ends the process: 1 when this throws.
  if (failed) throw new Error('focusables() differs from where Tab stops in Chrome');
});
