// A multi-line Edit as high on the DOM as on the canvases, against Chrome
// (test/fixtures/heights.json, recorded by scripts/heights-oracle.mjs): for
// each case (a font and line height passed down, an autosize, a style with
// paddings, borders and heights, a value of one line or seven) ren-dom
// writes the inline heights and paddings Chrome was given, and a ren-canv
// Document lays the Edit out at the height Chrome gave them. Its rows are
// its own lines (not the theme's), padded less its own top border.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { $root, $signal, $read, $write } from 'rrx-core';
import { Root, View, Edit, $dispose } from 'ren-core';
import { Document, render as draw, loadLayout } from 'ren-canv';
import { $dom, render } from 'ren-dom';

/** @typedef {{ font: object, autosize: number | boolean, style: object, value: string, height: number, inline: Record<string, string> }} Case */
const oracle = /** @type {{ recorded: string, cases: Case[] }} */ (JSON.parse(readFileSync(new URL('./fixtures/heights.json', import.meta.url), 'utf8')));
const INLINE = ['height', 'min-height', 'max-height', 'padding-top', 'padding-bottom', 'padding-block'];

await loadLayout();

const mono = {
  width: (/** @type {string} */ text, /** @type {number} */ size) => (text.length * size) / 2,
  metrics: (/** @type {number} */ size) => ({ ascent: size * 0.8, descent: size * 0.2 }),
  close() {},
};

/** The cases' Edits, each alone at the top of a box 400 high. @param {(e: any) => void} [ref] */
const view = ref => (
  <View style={{ width: 300 }}>
    {oracle.cases.map(c => (
      <View style={{ height: 400, align: 'start', ...c.font }}>
        <Edit ref={ref} lines={2} autosize={c.autosize} value={c.value} style={{ width: 200, ...c.style }} />
      </View>
    ))}
  </View>
);

/** A case's name. @param {Case} c */
const nameOf = c => JSON.stringify({ font: c.font, autosize: c.autosize, style: c.style, lines: c.value.split('\n').length });

describe(`ren dom multi-line Edit heights, as ${oracle.recorded} and the canvases size them`, () => {
  /** @type {Window[]} */
  const windows = [];
  after(async () => {
    for (const window of windows.splice(0)) await window.happyDOM.close();
  });

  it('writes the heights and paddings Chrome was given', () => {
    const window = new Window();
    windows.push(window);
    const document = window.document;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const root = Root({ id: 'heights', target, renderer: $dom(/** @type {any} */ (document)), children: view() });
    const areas = [...document.querySelectorAll('textarea')];
    assert.equal(areas.length, oracle.cases.length);
    oracle.cases.forEach((c, i) => {
      const got = Object.fromEntries(INLINE.map(p => [p, areas[i].style.getPropertyValue(p)]).filter(e => e[1] !== ''));
      assert.deepEqual(got, c.inline, nameOf(c));
    });
    $dispose(root);
  });

  it('lays each Edit out on a canvas at the height Chrome gave it', () => {
    const doc = new Document(mono, { width: 400, height: 400 * oracle.cases.length + 100 });
    /** @type {any[]} */
    const edits = [];
    draw(() => view(e => edits.push(e)), doc);
    doc.present();
    oracle.cases.forEach((c, i) => assert.ok(Math.abs(edits[i].getBoundingClientRect().height - c.height) < 1e-3, `${nameOf(c)}: ${edits[i].getBoundingClientRect().height} on the canvas, ${c.height} in Chrome`));
    doc.close();
  });

  it('keeps its rows a field high without an application root (no theme properties)', () => {
    const window = new Window();
    windows.push(window);
    const target = window.document.createElement('div');
    window.document.body.appendChild(target);
    const bare = $root('bare');
    render(() => <Edit lines={3} style={{ border: 5 }} />, target, { root: bare });
    const area = target.querySelector('textarea');
    assert.equal(area.style.height, 'calc(var(--ren-field, 38px) + 2 * 1lh)');
    assert.equal(area.style.getPropertyValue('padding-block'), 'max(0px, calc((var(--ren-field, 38px) - 1lh) / 2 - 5px))', 'less its own border');
    $dispose(bare);
  });

  it('pads its rows again as its style\'s border changes or its padding goes', () => {
    const window = new Window();
    windows.push(window);
    const target = window.document.createElement('div');
    window.document.body.appendChild(target);
    const root = $root('changes');
    const look = $signal(root, /** @type {Record<string, any>} */ ({ border: 6 }));
    render(() => <Edit lines={2} style={() => $read(look)} />, target, { root });
    const area = /** @type {any} */ (target.querySelector('textarea'));
    const pad = (/** @type {string} */ edge) => `max(0px, calc((var(--ren-field, 38px) - 1lh) / 2 - ${edge}))`;
    const sides = () => [area.style.getPropertyValue('padding-top'), area.style.getPropertyValue('padding-bottom')];
    assert.equal(area.style.getPropertyValue('padding-block'), pad('6px'));
    $write(look, { borderTop: 2, border: 3 });
    assert.equal(area.style.getPropertyValue('padding-block'), pad('3px'), 'the last width written reaches the top');
    $write(look, { border: 3, borderTop: 2 });
    assert.equal(area.style.getPropertyValue('padding-block'), pad('2px'));
    $write(look, {});
    assert.equal(area.style.getPropertyValue('padding-block'), pad('1px'), "the sheet's border again");
    $write(look, { padding: [20, 10, 4, 10] });
    assert.deepEqual(sides(), ['20px', '4px'], "the style's padding wins");
    $write(look, {});
    assert.equal(area.style.getPropertyValue('padding-block'), pad('1px'), 'unset, the rows\' padding again');
    $dispose(root);
  });
});
