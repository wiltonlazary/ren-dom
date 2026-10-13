// A node's moves on the DOM (ren-core's `$moves`): an IntersectionObserver
// whose root margin leaves exactly the node's box hears any move (a layout
// shift, a transform, an animation) in the next rendering step; the box is
// measured, a new place told, and observed again. happy-dom's observers
// report nothing, so the test drives stand-ins for both.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $write } from 'rrx-core';
import { View, Show, $moves } from 'ren-core';
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

const setup = () => {
  const window = new Window({ width: 800, height: 600 });
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  // The viewport the root margin is taken from (happy-dom lays nothing out).
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 800 });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 600 });
  /** Every IntersectionObserver made, with its options and state. @type {any[]} */
  const made = [];
  /** @type {any} */ (window).IntersectionObserver = class {
    /** @param {(entries: any[]) => void} fn @param {any} options */
    constructor(fn, options) {
      this.fn = fn;
      this.options = options;
      /** @type {any[]} */
      this.nodes = [];
      this.live = true;
      made.push(this);
    }
    /** @param {any} node */
    observe(node) {
      this.nodes.push(node);
    }
    disconnect() {
      this.live = false;
    }
    /** Reports `ratio` of its node showing. @param {number} ratio */
    report(ratio) {
      this.fn([{ target: this.nodes[0], intersectionRatio: ratio }]);
    }
  };
  /** @type {any[]} */
  const sizes = [];
  /** @type {any} */ (window).ResizeObserver = class {
    /** @param {(entries: any[]) => void} fn */
    constructor(fn) {
      this.fn = fn;
      sizes.push(this);
    }
    /** @param {any} node */
    observe(node) {
      this.node = node;
    }
    unobserve() {}
    disconnect() {}
    /** Reports its node's size. */
    report() {
      const r = this.node.getBoundingClientRect();
      this.fn([{ target: this.node, borderBoxSize: [{ inlineSize: r.width, blockSize: r.height }] }]);
    }
  };
  return { window, document, container, made, sizes };
};

/** The live observer. @param {any[]} made */
const live = made => {
  const on = made.filter(o => o.live);
  assert.equal(on.length, 1, 'one observer at a time');
  return on[0];
};

describe('ren dom moves', () => {
  it('hears a move for any reason, told once, and observes the box again where it went', () => {
    const { container, made, sizes } = setup();
    const root = $root('app');
    const open = $signal(root, false);
    /** @type {any} */
    let target = null;
    /** @type {string[]} */
    const heard = [];
    const Follow = () => {
      $moves(target, e => heard.push(`${e.type} ${e.x},${e.y}`));
      return <View />;
    };
    render(() => (
      <View>
        <View ref={n => (target = n)} />
        <Show when={open}>
          <Follow />
        </Show>
      </View>
    ), container, { root });
    const box = { x: 100, y: 50, width: 80, height: 30 };
    target.getBoundingClientRect = () => ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height });
    // Heard from a node in the document: observed at once; the ResizeObserver's first report, of the same size, changes nothing.
    $write(open, true);
    const first = live(made);
    sizes[0].report();
    assert.equal(live(made), first);
    assert.deepEqual(first.options.threshold, [1]);
    assert.equal(first.options.rootMargin, '-50px -620px -520px -100px', 'the root leaves exactly its box');
    assert.equal(first.options.root, target.ownerDocument);
    first.report(1);
    assert.deepEqual(heard, [], 'placed where it was: no move');
    // The content above grows: the box moves down, so less of it is in the margin.
    box.y = 90;
    first.report(0.4);
    assert.deepEqual(heard, ['move 100,90']);
    const second = live(made);
    assert.notEqual(second, first);
    assert.equal(second.options.rootMargin, '-90px -620px -480px -100px', 'observed where it went');
    second.report(1);
    // A transform moves it across by a pixel.
    box.x = 101;
    second.report(0.98);
    assert.deepEqual(heard, ['move 100,90', 'move 101,90']);
    // A stale report from a replaced observer is not heard.
    second.fn([{ target, intersectionRatio: 0.5 }]);
    assert.deepEqual(heard, ['move 100,90', 'move 101,90']);
    $write(open, false);
    assert.equal(made.filter(o => o.live).length, 0, 'stopped with its owner');
  });

  it('observes a clipped box at its ratio, and one clipped whole until any of it shows', () => {
    const { container, made, sizes } = setup();
    /** @type {any} */
    let target = null;
    /** @type {number[]} */
    const heard = [];
    const Follow = () => {
      $moves(target, e => heard.push(e.y));
      return <View />;
    };
    render(() => (
      <View>
        <View ref={n => (target = n)} />
        <Follow />
      </View>
    ), container);
    const box = { x: 0, y: 0, width: 100, height: 40 };
    target.getBoundingClientRect = () => ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height });
    // Heard before it was in the document: observed once laid out.
    assert.equal(made.length, 0);
    sizes[0].report();
    live(made).report(0.5);
    const half = live(made);
    assert.deepEqual(half.options.threshold, [0.5, 0.5001], 'heard when more or less of it shows');
    half.report(0.5);
    box.y = -30;
    half.report(0.2);
    assert.deepEqual(heard, [-30]);
    live(made).report(0);
    assert.deepEqual(live(made).options.threshold, [1e-7], 'clipped whole: heard when any shows');
    live(made).report(0);
    assert.equal(made.filter(o => o.live).length, 1, 'and waits');
    box.y = 10;
    live(made).report(0.3);
    assert.deepEqual(heard, [-30, 10]);
  });
});
