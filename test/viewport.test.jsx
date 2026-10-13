// The viewport on the DOM: the window's inner size and media preferences,
// read reactively through ren-core's $viewport and $media.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { $read, $dispose } from 'rrx-core';
import { Root, Label, $viewport, $media } from 'ren-core';
import { $dom } from 'ren-dom';
import { closeAfter } from './fixtures/after.js';

describe('ren dom viewport', () => {
  it("follows the window's size and preferences, and lets go with the last reader", async t => {
    const window = new Window({ width: 1280, height: 720, settings: { device: { prefersColorScheme: 'dark', prefersReducedMotion: 'reduce' } } });
    closeAfter(t, () => window.happyDOM.close());
    const document = window.document;
    let listeners = 0;
    const win = /** @type {any} */ (document.defaultView);
    const add = win.addEventListener.bind(win);
    const remove = win.removeEventListener.bind(win);
    win.addEventListener = (/** @type {string} */ type, /** @type {any} */ fn, /** @type {any} */ o) => {
      if (type === 'resize') listeners++;
      return add(type, fn, o);
    };
    win.removeEventListener = (/** @type {string} */ type, /** @type {any} */ fn, /** @type {any} */ o) => {
      if (type === 'resize') listeners--;
      return remove(type, fn, o);
    };
    const App = () => {
      const v = $viewport();
      const wide = $media('(min-width: 62em)');
      return <Label text={() => `${$read(v.width)}x${$read(v.height)} ${$read(wide) ? 'wide' : 'narrow'}${$read(v.dark) ? ' dark' : ''}${$read(v.reduced) ? ' reduced' : ''}`} />;
    };
    const root = Root({ id: 'shell', target: document.body, renderer: $dom(document, { styles: false }), children: () => <App /> });
    const label = () => document.querySelector('[data-ren="Label"]')?.textContent;
    assert.equal(label(), '1280x720 wide dark reduced');
    assert.ok(listeners > 0, 'it listens while it is read');
    window.happyDOM.setViewport({ width: 600, height: 800 });
    assert.equal(label(), '600x800 narrow dark reduced');
    $dispose(root);
    assert.equal(listeners, 0, 'none after the last reader');
  });
});
