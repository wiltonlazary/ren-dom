// Development mode on the DOM: reads in component bodies and row callbacks,
// where nothing tracks them.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $untrack, $development, $context, $lookup, $update, $flush } from 'rrx-core';
import { For, $active } from 'ren-core';
import { render } from 'ren-dom';

/** The happy-dom windows this file's tests open, each closed after its test (its window.close() frees nothing). @type {HappyWindow[]} */
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

describe('ren-core development mode', () => {
  it('reports reads in component bodies and row callbacks; JSX, accessors and $untrack are fine', () => {
    /** @type {string[]} */
    const messages = [];
    $development(true, message => void messages.push(message));
    try {
      const window = new Window();
      const container = window.document.createElement('div');
      const root = $root('app');
      const name = $signal(root, 'ada');
      const items = $signal(root, [1, 2]);
      function Frozen() {
        const once = $read(name);
        return <p>{once}</p>;
      }
      function Live() {
        const meant = $untrack($active(), () => $read(name));
        return <p title={meant}>{() => $read(name)}</p>;
      }
      render(() => (
        <div>
          <Frozen />
          <Live />
          <For each={items}>{item => <i>{String(item())}</i>}</For>
        </div>
      ), container, { root });
      assert.equal(messages.length, 3, messages.join('\n'));
      assert.match(messages[0], /^REN dev: Frozen read reactive state in its body/);
      assert.match(messages[1], /^REN dev: a For row read reactive state/);
    } finally {
      $development(false, null);
    }
  });

  it('takes a context read in a body as the value it builds with: not reported; an accessor still follows $update', () => {
    /** @type {string[]} */
    const messages = [];
    $development(true, message => void messages.push(message));
    try {
      const window = new Window();
      const container = window.document.createElement('div');
      const root = $root('app');
      const Tone = $context('plain');
      function Inner() {
        const once = $lookup(Tone);
        return <p title={once}>{() => $lookup(Tone)}</p>;
      }
      function Outer() {
        const tone = $lookup(Tone);
        return <b data-tone={tone}><Inner /></b>;
      }
      render(() => <Tone value="warm"><Outer /><button onClick={() => $update(Tone, 'cool')} /></Tone>, container, { root });
      assert.deepEqual(messages, [], 'a body lookup is not a stale read');
      const p = /** @type {any} */ (container.querySelector('p'));
      assert.equal(p.title, 'warm');
      assert.equal(p.textContent, 'warm');
      /** @type {any} */ (container.querySelector('button')).click();
      $flush(root);
      assert.equal(p.textContent, 'cool', 'the accessor follows the provider');
      assert.equal(p.title, 'warm', 'the body kept what it built with');
    } finally {
      $development(false, null);
    }
  });
});
