// The primitives laid out by a layout engine instead of the browser (the
// `layout` option, ren-canv's Flow): each primitive's element sits at the
// box a ren-canv Document computes for the same view, the top of the view
// at its container's width; changes move only what moved; the CSS keeps
// paint and text, not the box model. happy-dom has no layout of its own: a
// fixed-width measure stands for the browser's text (5 wide per character
// at fontSize 10, 20 high per line).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $signal, $read, $write } from 'rrx-core';
import { Root, $dispose, View, Label, Action, Edit, Show, $active } from 'ren-core';
import { mount } from 'ren-core/host';
import { Document, Flow, render as draw, loadLayout, remoteLayout, serveLayout } from 'ren-canv';
import { $dom, $shadow } from 'ren-dom';
import { closeAfter } from './fixtures/after.js';


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

await loadLayout();

const mono = {
  width: (/** @type {string} */ text, /** @type {number} */ size) => (text.length * size) / 2,
  metrics: (/** @type {number} */ size) => ({ ascent: size * 0.8, descent: size * 0.2 }),
  close() {},
};
const card = { padding: 10, gap: 5, fontSize: 10, lineHeight: 2, border: 2, margin: 3 };

const setup = () => {
  const window = new Window();
  const document = window.document;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 400 });
  document.body.appendChild(container);
  return { window, document, container };
};

/** The view: a row with wrapping text, a grid (with a boxless row), text children, and a part that comes and goes. */
function App() {
  /** @type {any} */
  const app = {};
  app.view = () => {
    const R = $active();
    const shown = (app.shown = $signal(R, true));
    const text = (app.text = $signal(R, 'words that wrap in a column of two hundred'));
    return (
      <View style={card}>
        <Label>title {() => ($read(shown) ? 'on' : 'off')}</Label>
        <View style={{ direction: 'row', gap: 4 }}>
          <View style={{ width: 200 }}><Label wrap text={() => $read(text)} /></View>
          <Action text="go" style={{ grow: 1 }} />
        </View>
        <Show when={() => $read(shown)}>
          <View style={{ display: 'grid', columns: '1fr 1fr', gap: 4 }}>
            <Label text="a" />
            <Label text="b" />
            {/* A row with no box: its cells sit in the grid. */}
            <View data-row style={{ display: 'contents' }}><Label text="c" /><Label text="d" /></View>
          </View>
        </Show>
        <View data-pop style={{ position: 'absolute', top: '100%', right: 0, width: '25%', height: 30, zIndex: 5 }} />
      </View>
    );
  };
  return app;
}

/** Each drawn item's box in its parent's padding box (a ren-canv Document, 400 wide), the top one at its place. @param {Document} doc */
function reference(doc) {
  /** @type {number[][]} */
  const out = [];
  /** @param {any} item @param {boolean} top */
  const walk = (item, top) => {
    doc.boxes.fix(item);
    const inset = top ? 0 : item.parent.r.bw;
    out.push([item.x - inset, item.y - inset, item.w, item.h]);
    for (let c = item.first; c !== null; c = c.next) if (c.kind !== 8 && c.kind !== 9) walk(c, false);
  };
  walk(doc.root.first, true);
  return out;
}

/** Each primitive element's placed box, in document order (one with no box, display contents, empty as its item's). @param {any} container */
const placed = container =>
  [...container.querySelectorAll('[data-ren]')].map((/** @type {any} */ el) => (el.style.display === 'contents' ? [0, 0, 0, 0] : ['left', 'top', 'width', 'height'].map(k => parseFloat(el.style[k]))));

describe('ren dom laid out by a layout engine', () => {
  it('grows an autosized Edit the view does not control as its value is typed, as the canvases do', () => {
    const { window, document, container } = setup();
    const flow = new Flow(mono);
    mount($dom(document, { layout: flow }), () => <View><Edit lines={2} autosize={6} /></View>, container);
    const area = /** @type {any} */ (container.querySelector('textarea'));
    const before = parseFloat(area.style.height);
    area.value = 'one\ntwo\nthree\nfour\nfive';
    area.dispatchEvent(new window.Event('input', { bubbles: true }));
    const after = parseFloat(area.style.height);
    // Its item grows with the rows typed: three more than its two.
    const doc = new Document(mono, { width: 400, height: 600 });
    draw(() => <View><Edit lines={2} autosize={6} value={'one\ntwo\nthree\nfour\nfive'} /></View>, doc);
    doc.present();
    const expected = /** @type {any} */ (doc.root.first?.first).h;
    assert.ok(after > before, `grown: ${before} to ${after}`);
    assert.equal(after, expected, 'as high as the canvases make it');
    doc.close();
    flow.close();
  });

  it("lays out on a new theme's metrics when setTheme gives them (the Flow's retheme)", () => {
    const { document, container } = setup();
    const tokens = { field: 30, entry: 100, text: 10, leading: 2 };
    const flow = new Flow(mono, { theme: tokens });
    const renderer = $dom(document, { layout: flow, theme: tokens });
    mount(renderer, () => <View style={{ align: 'start' }}><Edit /><Label text="abcd" /></View>, container);
    const sizes = () => [/** @type {any} */ (container.querySelector('input')), /** @type {any} */ (container.querySelector('[data-ren="Label"]'))].flatMap(el => [parseFloat(el.style.width), parseFloat(el.style.height)]);
    assert.deepEqual(sizes(), [100, 30, 20, 20]);
    /** @type {any} */ (renderer).setTheme({ field: 40, entry: 160, text: 20, leading: 1.5 });
    assert.deepEqual(sizes(), [160, 40, 40, 30], "the Edit and the Label placed on the new theme's metrics");
    flow.close();
  });

  it('places every primitive at the box a ren-canv Document computes, and follows changes', () => {
    const { document, container } = setup();
    const flow = new Flow(mono);
    const dom = App();
    const canvas = App();
    mount($dom(document, { layout: flow }), dom.view, container);
    const doc = new Document(mono, { width: 400, height: 600 });
    draw(canvas.view, doc);
    assert.deepEqual(placed(container), reference(doc));
    const top = container.querySelector('[data-ren]');
    assert.equal(top.style.position, 'relative', 'the top of the view keeps its place in the page');
    assert.equal(container.querySelector('[data-ren="Label"]').style.position, 'absolute');
    // The box model is the engine's: no size, margin, gap or flex in the CSS; paint and text stay.
    assert.equal(top.style.margin, '0px');
    assert.equal(top.style.gap, '');
    assert.equal(top.style.borderWidth, '2px');
    assert.equal(top.style.paddingLeft, '10px');
    assert.equal(top.style.fontSize, '10px');
    assert.equal(container.querySelector('[data-row]').style.display, 'contents', 'a boxless row stays so in the CSS: its cells sit against the grid');
    const pop = container.querySelector('[data-pop]');
    assert.equal(pop.style.zIndex, '5', 'the stacking order stays CSS');
    assert.equal(pop.style.position, 'absolute');
    for (const change of [(/** @type {any} */ app) => $write(app.text, 'short'), (/** @type {any} */ app) => $write(app.shown, false), (/** @type {any} */ app) => $write(app.shown, true)]) {
      change(dom);
      change(canvas);
      doc.present();
      assert.deepEqual(placed(container), reference(doc));
    }
    doc.close();
    flow.close();
  });

  it('places a right-to-left view from its right, as a ren-canv Document does, and writes its dir', () => {
    const { container, document } = setup();
    const flow = new Flow(mono);
    const view = () => (
      <View dir="rtl" style={{ ...card, direction: 'row' }}>
        <Label text="abc" />
        <View style={{ display: 'grid', columns: '30px 1fr', width: 120 }}>
          <Label text="a" />
          <Label text="b" />
        </View>
        <View style={{ width: 40, height: 10, margin: [0, 6, 0, 0] }} />
      </View>
    );
    mount($dom(document, { layout: flow }), view, container);
    const doc = new Document(mono, { width: 400, height: 600 });
    draw(view, doc);
    assert.deepEqual(placed(container), reference(doc));
    const top = container.querySelector('[data-ren]');
    assert.equal(top.getAttribute('dir'), 'rtl', 'the browser sets its text right to left');
    // The first child at the right of the content box, in the padding box: 394 wide (its margins 3) less its borders (2) and padding (10), less its 15.
    assert.deepEqual(placed(container)[1], [365, 10, 15, 20]);
    doc.close();
    flow.close();
  });

  it('places them from a layout worker once it answers', { timeout: 30000 }, async t => {
    const channel = new MessageChannel();
    const stop = serveLayout(channel.port2);
    const layout = remoteLayout(channel.port1);
    // The ports keep the process alive: they close after the test however it ends, a timeout too.
    closeAfter(t, () => {
      layout.close();
      stop();
      channel.port1.close();
    });
    const { document, container } = setup();
    const flow = new Flow(mono, { layout });
    closeAfter(t, () => flow.close());
    const dom = App();
    mount($dom(document, { layout: flow }), dom.view, container);
    await new Promise(resolve => flow.arrange(resolve));
    const doc = new Document(mono, { width: 400, height: 600 });
    closeAfter(t, () => doc.close());
    draw(App().view, doc);
    assert.deepEqual(placed(container), reference(doc));
  });

  for (const mode of /** @type {const} */ (['open', 'closed'])) {
    it(`follows its host's width under a ${mode} shadow root`, () => {
      const { window, document, container } = setup();
      /** @type {any} */ let observed = null;
      /** @type {any} */ (window).ResizeObserver = class {
        constructor(/** @type {any} */ fn) {
          observed = fn;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      let width = 400;
      /** @type {any} */ let top = null;
      const flow = new Flow(mono);
      const root = Root({
        id: `r-${mode}`,
        target: container,
        renderer: $shadow({ mode, styles: false, document, layout: flow }),
        children: () => <View ref={(/** @type {any} */ el) => (top = el)} style={{ fontSize: 10, lineHeight: 2 }}><Label text="hi" /></View>,
      });
      const host = /** @type {any} */ (container.querySelector(`[data-ren-root="r-${mode}"]`));
      // The host's width, as a browser would report it.
      Object.defineProperty(host, 'clientWidth', { get: () => width });
      observed([{ target: host }]);
      assert.equal(top.style.width, '400px');
      width = 200;
      observed([{ target: host }]);
      assert.equal(top.style.width, '200px');
      $dispose(root);
      flow.close();
    });
  }
});
