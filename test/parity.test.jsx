// Direct and worker mode hear the same events on the DOM. One script of
// input (clicks, focus moves, keys, scrolls, pointer moves and presses,
// wheels) drives a view ren-dom renders directly and one a worker session
// renders through ren-core's connection, each in its own happy-dom window,
// and the handler logs must match: exactly, except that a burst of
// superseding events (moves, scrolls) may drop the older ones, so its log is
// a subsequence of the direct log that ends with the same entry.

import { it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root } from 'rrx-core';
import { View, Label, Action, Scroll, $keys, $scrolls } from 'ren-core';
import { render, $dom } from 'ren-dom';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { closeAfter } from './fixtures/after.js';

/** The happy-dom windows this file's tests open, each closed after its test. @type {HappyWindow[]} */
const windows = [];
/** happy-dom's Window, tracked for closing. */
class Window extends HappyWindow {
  /** @param {ConstructorParameters<typeof HappyWindow>} args */
  constructor(...args) {
    super(...args);
    windows.push(this);
  }
}
afterEach(async () => {
  for (const window of windows.splice(0)) await window.happyDOM.close();
});

/**
 * A handler that logs who heard what, and stops the event where the script
 * says: A stops presses, focus, blur and Escape, and moves with Shift; the
 * View stops moves with Alt; the Scroll stops its scrolls.
 * @param {string[]} log @param {string} tag @param {string} name
 */
const handler = (log, tag, name) => (/** @type {any} */ e) => {
  const mods = `${e.shiftKey ? 'S' : ''}${e.ctrlKey ? 'C' : ''}${e.altKey ? 'A' : ''}${e.metaKey ? 'M' : ''}`;
  log.push(`${tag} ${name} x=${e.x ?? e.clientX ?? 0} y=${e.y ?? e.clientY ?? 0} b=${e.button ?? -1} ${mods} ${e.key ?? ''}${e.deltaY ? ` dy=${e.deltaY}` : ''}`);
  const stop =
    (tag === 'A' && (name === 'press' || name === 'focus' || name === 'blur' || (name === 'key' && e.key === 'Escape') || (name === 'pointermove' && e.shiftKey))) ||
    (tag === 'outer' && name === 'pointermove' && e.altKey) ||
    (tag === 'scroll' && name === 'scroll');
  if (stop) e.stopPropagation();
};

/** @param {string[]} log */
const App = log => () => {
  $keys(handler(log, 'root', 'keys'));
  $scrolls(handler(log, 'root', 'scrolls'));
  /** @param {string} tag */
  const on = tag => ({
    onPress: handler(log, tag, 'press'),
    onPointerMove: handler(log, tag, 'pointermove'),
    onPointerDown: handler(log, tag, 'pointerdown'),
    onFocus: handler(log, tag, 'focus'),
    onBlur: handler(log, tag, 'blur'),
    onFocusIn: handler(log, tag, 'focusin'),
    onFocusOut: handler(log, tag, 'focusout'),
    onKey: handler(log, tag, 'key'),
    onWheel: handler(log, tag, 'wheel'),
  });
  return (
    <View {...on('outer')}>
      <Action text="A" {...on('A')} />
      <Action text="B" {...on('B')} />
      <Scroll style={{ height: 40 }} onScroll={handler(log, 'scroll', 'scroll')}>
        {Array.from({ length: 10 }, (_, i) => <Label text={`row ${i}`} />)}
      </Scroll>
    </View>
  );
};

/**
 * A wheel event: happy-dom's WheelEvent drops the modifier keys and the
 * point, so a plain Event carries them.
 * @param {any} W @param {number} deltaY @param {{ ctrlKey?: boolean, shiftKey?: boolean }} [mods]
 */
const wheel = (W, deltaY, mods = {}) => {
  const e = new W.Event('wheel', { bubbles: true });
  const fields = { deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, clientX: 4, clientY: 4, ...mods };
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
  return e;
};
/** @param {any} W @param {string} k @param {object} [o] */
const key = (W, k, o = {}) => new W.KeyboardEvent('keydown', { key: k, bubbles: true, ...o });
/** @param {any} W @param {number} x @param {number} y @param {object} [o] */
const move = (W, x, y, o = {}) => new W.PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, ...o });
/** @param {any} W @param {number} x @param {number} y @param {object} [o] */
const down = (W, x, y, o = {}) => new W.PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, ...o });

/** A, B and the Scroll's elements. @param {any} c */
const elements = c => {
  const [a, b] = c.querySelectorAll('button');
  return { a, b, s: a.parentNode.lastElementChild };
};

/**
 * The script: bursts (the worker's messages) of input, each named; true
 * where the burst has superseding events.
 * @type {[string, boolean, (W: any, c: any, at: ReturnType<typeof elements>) => void][]}
 */
const SCRIPT = [
  ['clicks with stops', false, (W, c, { a, b }) => (a.click(), b.click())],
  ['focus moves', false, (W, c, { a, b }) => (a.focus(), b.focus(), a.focus())],
  ['focus B', false, (W, c, { b }) => b.focus()],
  ['blur', false, (W, c) => c.ownerDocument.activeElement.blur()],
  ['keys and $keys', false, (W, c, { a }) => (a.focus(), a.dispatchEvent(key(W, 'Escape')), a.dispatchEvent(key(W, 'x', { ctrlKey: true })), a.dispatchEvent(key(W, 'y', { shiftKey: true })))],
  ['a key on the body', false, (W, c) => (c.ownerDocument.activeElement?.blur(), c.ownerDocument.body.dispatchEvent(key(W, 'k')))],
  ['scroll and $scrolls', true, (W, c, { s }) => ((s.scrollTop = 20), s.dispatchEvent(new W.Event('scroll')))],
  ['moves, A stops with Shift', true, (W, c, { a }) => (c.firstChild.dispatchEvent(move(W, 150, 10)), a.dispatchEvent(move(W, 5, 5, { shiftKey: true })))],
  ['moves, the View stops with Alt', true, (W, c, { a, b }) => (a.dispatchEvent(move(W, 5, 5)), a.dispatchEvent(move(W, 6, 5, { shiftKey: true })), b.dispatchEvent(move(W, 5, 25, { altKey: true, button: 2 })))],
  ['the latest move wins', true, (W, c, { b }) => (b.dispatchEvent(move(W, 5, 25, { button: 0 })), b.dispatchEvent(move(W, 6, 26, { ctrlKey: true, metaKey: true, button: 1 })))],
  ['presses with modifiers', false, (W, c, { a, b }) => (a.dispatchEvent(down(W, 1, 2, { shiftKey: true })), b.dispatchEvent(down(W, 3, 4, { button: 2, altKey: true })))],
  // A wheel, a Ctrl+wheel (a zoom) and a Shift+wheel: none adds up with another.
  ['wheels with other modifiers', false, (W, c, { a, b }) => (a.dispatchEvent(wheel(W, 100)), a.dispatchEvent(wheel(W, 3, { ctrlKey: true })), b.dispatchEvent(wheel(W, 7, { shiftKey: true })), b.dispatchEvent(wheel(W, 9)))],
  ['many clicks', false, (W, c, { a, b }) => {
    for (let n = 0; n < 120; n++) (n % 2 === 1 ? b : a).click();
  }],
];

/** Whether `part` is `whole` with entries left out, in order. @param {string[]} part @param {string[]} whole */
const within = (part, whole) => {
  let i = 0;
  for (const entry of part) {
    while (i < whole.length && whole[i] !== entry) i++;
    if (i++ >= whole.length) return false;
  }
  return true;
};

it('hears the same events in worker mode as in direct mode', { timeout: 30000 }, async t => {
  /** @type {string[]} */
  const dl = [];
  /** @type {string[]} */
  const wl = [];
  const W1 = new Window();
  const W2 = new Window();
  const c1 = W1.document.createElement('div');
  W1.document.body.appendChild(c1);
  const c2 = W2.document.createElement('div');
  W2.document.body.appendChild(c2);
  const dispose = render(App(dl), c1, { root: $root('app') });
  const { port1, port2 } = new MessageChannel();
  const connection = connect(port2, $dom(/** @type {any} */ (W2.document)), c2, { schedule: 'now' });
  const session = serve(App(wl), { port: port1, root: $root('app') });
  closeAfter(t, () => {
    connection.close();
    session.close();
    port1.close();
    port2.close();
    dispose();
  });
  await connection.idle();
  assert.equal(c2.innerHTML, c1.innerHTML, 'one DOM');
  const e1 = elements(c1);
  const e2 = elements(c2);
  for (const [name, supersedes, step] of SCRIPT) {
    step(W1, c1, e1);
    step(W2, c2, e2);
    await connection.idle();
    const expected = dl.splice(0);
    const heard = wl.splice(0);
    assert.ok(expected.length > 0, `${name} is heard`);
    if (!supersedes) assert.deepEqual(heard, expected, name);
    else {
      assert.ok(within(heard, expected), `${name}: ${JSON.stringify(heard)} within ${JSON.stringify(expected)}`);
      assert.equal(heard.at(-1), expected.at(-1), `${name} ends with the latest`);
    }
  }
});
