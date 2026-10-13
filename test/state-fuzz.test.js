// State values at random, against a model of CSS Syntax: whatever ren-dom
// keeps of a hover value (in a happy-dom document, whose CSSOM keeps more
// than a browser's), the state sheet it writes must read, by
// the standard's tokenizer and rule parsing, as its own rules and nothing
// else. Each random value's View is followed by a View whose rule must come
// through whole, and no token of the sheet may be a parse error that ends
// early (a bad string or url, the end inside one or in a comment). The
// values grow from pieces that open, close and escape (quotes, brackets,
// `url(` and names ending in it, escapes, comments); seeds are fixed, and a
// failure names the seed and the value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { View } from 'ren-core';
import { jsx } from 'ren-core/jsx-runtime';
import { Window } from 'happy-dom';
import { render } from 'ren-dom';
import { rules, text } from './fixtures/css-syntax.js';

const SEEDS = [1, 2, 3];
const VALUES = 1500;
/** Single pieces that open, close, escape or comment. */
const PIECES = ['\\', '"', "'", '(', ')', '[', ']', '/', '*', 'u', 'r', 'l', 'U', 'R', 'L', 'a', '7', 'd', '2', '9', ' ', '\t', '!', '@', '#', ',', ':', '%', '\u0000', '\ud800', 'url(', 'URL(', '\\75', '\\72 ', '\\6c', '\\29', '\\22', '\\a', '\\\t', '\\ ', '/*', '*/', 'x', '-', '--', '0', 'e', '+', '.', '\u000b', '\u007f', '\u0008', '\\0', '\\110000', 'important', '$', '^', '|', '~', '=', '&', '`'];
/** Names that are, or only end in, `url`. */
const URLISH = ['url', 'URL', 'rurl', '#url', '@url', 'u\\72l', '\\75rl', '-url', '--url', '1url', '.url', 'x-url', 'uRl'];
/** What goes in a url-like name's parentheses. */
const INNER = ['x', '[', ']', '(', '"', "'", ' ', '\\29', '\\', '/*', '*/', '.png', '%', ')'];
/**
 * Random values, grown from a small grammar over those pieces: strings,
 * brackets and functions (some left open), and names that end in `url`
 * before `(` (`url`, `rurl`, `#url`, `@url`, escaped ones), their contents
 * pieces a url and a block read differently.
 * @param {number} seed
 */
const generator = seed => {
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  /** @template T @param {T[]} list */
  const pick = list => list[Math.floor(next() * list.length)];
  /** Up to `count` pieces of `list`. @param {string[]} list @param {number} count */
  const some = (list, count) => {
    let s = '';
    for (let k = Math.floor(next() * count); k > 0; k--) s += pick(list);
    return s;
  };
  /** @param {number} depth @returns {string} */
  const seq = depth => {
    let v = '';
    for (let k = 1 + Math.floor(next() * 3); k > 0; k--) v += item(depth);
    return v;
  };
  /** @param {number} depth @returns {string} */
  const item = depth => {
    const r = next();
    if (r < 0.3 || depth > 2) return pick(PIECES);
    if (r < 0.45) {
      const quote = pick(['"', "'"]);
      return quote + some(PIECES, 3) + (next() < 0.8 ? quote : '');
    }
    if (r < 0.7) return `${pick(URLISH)}(${some(INNER, 3)}${next() < 0.85 ? ')' : ''}`;
    if (r < 0.9) {
      const [open, close] = pick([['(', ')'], ['[', ']'], ['f(', ')']]);
      return open + seq(depth + 1) + (next() < 0.85 ? close : '');
    }
    return pick([')', ']', '"', '\\', '/*', ' ']);
  };
  return () => seq(0);
};

/** The random values of a seed. @param {number} seed */
const values = seed => {
  const next = generator(seed);
  return Array.from({ length: VALUES }, next);
};

for (const seed of SEEDS)
  test(`seed ${seed}: every state rule written reads as its own, the next one whole`, async (/** @type {import('node:test').TestContext} */ t) => {
    const window = new Window();
    t.after(() => window.happyDOM.close());
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const list = values(seed);
    render(
      () =>
        jsx('div', {
          children: list.flatMap((value, k) => [
            jsx(View, { 'data-value': String(k), style: { hover: { '--x': value } } }),
            jsx(View, { 'data-next': String(k), style: { hover: { background: `rgb(${k % 256}, ${k >> 8}, 3)` } } }),
          ]),
        }),
      container,
    );
    const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]')).textContent;
    const html = container.innerHTML;
    const found = rules(sheet);
    /** The rules by their selector, as the model reads them. @type {Map<string, string>} */
    const bySelector = new Map();
    for (const rule of found) bySelector.set(text(rule.prelude), text(rule.block ?? []));
    /** Each View's state class, by its `data-value` or `data-next` and index. @type {Map<string, string>} */
    const classes = new Map();
    for (const [tag] of html.matchAll(/<div [^>]*>/g)) {
      const mark = tag.match(/data-(value|next)="(\d+)"/);
      const name = tag.match(/data-ren-state="([^"]*)"/);
      if (mark !== null && name !== null) classes.set(`${mark[1]} ${mark[2]}`, name[1]);
    }
    let kept = 0;
    list.forEach((value, k) => {
      const name = classes.get(`next ${k}`);
      assert.ok(name !== undefined, `seed ${seed}: the View after ${JSON.stringify(value)} has no state class`);
      const body = bySelector.get(`.${name}:hover`);
      assert.equal(body, `background: rgb(${k % 256}, ${k >> 8}, 3) !important`, `seed ${seed}: the rule after ${JSON.stringify(value)} is not whole`);
      if (classes.has(`value ${k}`)) kept++;
    });
    for (const rule of found) {
      const selector = text(rule.prelude);
      assert.ok(rule.at === null && /^\.[\w-]+:hover$/.test(selector), `seed ${seed}: a rule the renderer did not write: ${JSON.stringify(selector)}`);
      assert.ok(!rule.open, `seed ${seed}: ${selector} is left open`);
      assert.ok(!(rule.block ?? []).some(t => t.bad), `seed ${seed}: a parse error in ${selector}: ${JSON.stringify(text(rule.block ?? []))}`);
    }
    assert.equal(found.length, bySelector.size, `seed ${seed}: two rules of one selector`);
    assert.ok(kept > VALUES / 10, `seed ${seed}: only ${kept} values kept: the check saw too few`);
  });
