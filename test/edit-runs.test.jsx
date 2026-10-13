// An Edit's runs on the DOM: the field stays the Edit's element (its ref,
// value and selection API), its text transparent under a styled mirror right
// after it, a span per run; a run's background is a layer of the field's
// own background (under its caret and selection), not the mirror's; the
// mirror hides while the runs are not the value (a draft the view has not
// answered, a composition) and moves and leaves with its field, which
// ren-core never sees.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write, $dispose } from 'rrx-core';
import { View, Edit, For, Show, Root } from 'ren-core';
import { render, $dom } from 'ren-dom';

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
  const window = new Window();
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { window, document, container };
};

/** The user types: the field shows `text`, then the browser sends input. @param {any} input @param {string} text */
const type = (input, text) => {
  input.value = text;
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
};

/** Words as runs: `let` bold and purple, the rest plain. @param {string} value */
const tokens = value => value.split(/( )/).filter(t => t !== '').map(t => (t === 'let' ? { text: t, style: { fontWeight: 700, color: '#800080', background: '#ffec99' } } : { text: t }));

/** What a mirror shows: its spans' text and inline style. @param {any} box */
const shown = box => [...box.firstChild.children].map(s => [s.textContent, s.getAttribute('style') ?? '']);

describe('ren dom Edit runs', () => {
  it('keeps the faces of at most 64 fonts measured, the least recently used going first', () => {
    const { window, container } = setup();
    /** @type {string[]} */
    const measured = [];
    // A 2D context that records the fonts it measures (happy-dom's canvas has none).
    window.HTMLCanvasElement.prototype.getContext = function () {
      return {
        font: '',
        /** @param {string} text */
        measureText(text) {
          measured.push(this.font);
          return { width: text.length * 7 };
        },
      };
    };
    /** Mounts an Edit with runs at a font size; how many fonts it measured. @param {number} size */
    const at = size => {
      const before = measured.length;
      const box = window.document.createElement('div');
      container.appendChild(box);
      render(() => <Edit value="let x" runs={tokens('let x')} style={{ fontSize: size, fontFamily: 'Bounded' }} />, box);
      return measured.length - before;
    };
    assert.ok(at(1000) > 0, 'a new font is measured');
    assert.equal(at(1000), 0, 'and known after');
    for (let size = 1001; size < 1064; size++) at(size);
    assert.equal(at(1000), 0, 'the first, used again, is kept');
    at(1064);
    assert.ok(at(1001) > 0, 'past 64 fonts, the least recently used was dropped');
    assert.equal(at(1000), 0, 'a recently used one stays');
  });

  it('never shows a mirror before it has copied its field\'s font: a field built out of the document shows once in it', () => {
    const { container } = setup();
    const root = $root('app');
    const open = $signal(root, false);
    /** @type {any} */
    let field = null;
    // Show builds its content out of the document, then puts it in.
    render(() => (
      <View>
        <Show when={() => $read(open)}>
          <View><Edit ref={(/** @type {any} */ e) => (field = e)} value="let x" runs={tokens('let x')} /></View>
        </Show>
      </View>
    ), container, { root });
    $write(open, true);
    const mirror = field.nextElementSibling;
    assert.equal(mirror.getAttribute('data-ren-mirror'), '');
    assert.equal(mirror.style.display, 'flex', 'shown once in the document');
    assert.notEqual(mirror.style.getPropertyValue('font-size'), '', 'with the field\'s font copied');
    assert.equal(field.getAttribute('data-ren-runs'), '');
  });

  it('shows a Root\'s mirror once the Root puts its host in the document, after the build', async () => {
    const { document, container } = setup();
    /** @type {any} */
    let field = null;
    // A Root builds its view in its host element, then puts that in its target.
    Root({ id: 'code', target: container, renderer: $dom(document), children: () => <View><Edit ref={(/** @type {any} */ e) => (field = e)} value="let x" runs={tokens('let x')} /></View> });
    const mirror = field.nextElementSibling;
    assert.equal(field.isConnected, true);
    assert.equal(mirror.style.display, 'none', 'still as the build left it');
    // The document's mutation reaches the renderer after this job.
    await Promise.resolve();
    assert.equal(mirror.style.display, 'flex', 'shown, now in the document');
    assert.notEqual(mirror.style.getPropertyValue('font-size'), '', 'in the field\'s font');
    assert.equal(field.getAttribute('data-ren-runs'), '');
  });

  it('shows a mirror whose Root puts it in a shadow root, after the build, watching no document', async () => {
    const { window, document, container } = setup();
    let observers = 0;
    const Base = window.MutationObserver;
    window.MutationObserver = class extends Base {
      /** @param {any[]} args */
      constructor(...args) {
        super(.../** @type {[any]} */ (args));
        observers++;
      }
    };
    const shadow = container.attachShadow({ mode: 'open' });
    const target = document.createElement('div');
    shadow.appendChild(target);
    /** @type {any} */
    let field = null;
    const root = Root({ id: 'shadowed', target, renderer: $dom(document), children: () => <View><Edit ref={(/** @type {any} */ e) => (field = e)} value="let x" runs={tokens('let x')} /></View> });
    const mirror = field.nextElementSibling;
    assert.equal(field.isConnected, true);
    assert.equal(mirror.style.display, 'none', 'still as the build left it');
    await Promise.resolve();
    assert.equal(mirror.style.display, 'flex', 'shown once the job that built it ends');
    assert.equal(observers, 0, 'no document watched for it');
    $dispose(root);
  });

  it('keeps a mirror hidden, the field\'s text showing, while its field is out of the document', () => {
    const { window } = setup();
    const outside = window.document.createElement('div');
    /** @type {any} */
    let field = null;
    render(() => <View><Edit ref={(/** @type {any} */ e) => (field = e)} value="let x" runs={tokens('let x')} /></View>, outside);
    const mirror = field.nextElementSibling;
    assert.equal(mirror.style.display, 'none', 'not shown before it can copy the field\'s font');
    assert.equal(field.getAttribute('data-ren-runs'), null, 'the field keeps its own text');
  });

  it('draws the runs in a mirror after the field, whose own text is transparent; the value stays plain', () => {
    const { container } = setup();
    const root = $root('app');
    const value = $signal(root, 'let x');
    /** @type {any} */
    let ref = null;
    /** @type {string[]} */
    const heard = [];
    render(() => (
      <View>
        <Edit ref={e => (ref = e)} value={value} runs={() => tokens($read(value))} onChange={e => { heard.push(e.value); $write(value, e.value); }} />
      </View>
    ), container, { root });
    const input = container.querySelector('input');
    assert.equal(ref, input, 'the ref is the field');
    const box = input.nextSibling;
    assert.equal(box.getAttribute('data-ren-mirror'), '');
    assert.equal(box.getAttribute('aria-hidden'), 'true');
    assert.equal(box.style.display, 'flex');
    assert.deepEqual(shown(box).map(s => s[0]), ['let', ' ', 'x']);
    assert.match(shown(box)[0][1], /font-weight: 700/);
    assert.match(shown(box)[0][1], /color: #800080/);
    assert.doesNotMatch(shown(box)[0][1], /background/, "a run's background is not the mirror's, over the field's caret");
    assert.equal(input.getAttribute('data-ren-runs'), '', 'its text transparent (-webkit-text-fill-color, which happy-dom does not keep)');
    type(input, 'let x let');
    assert.deepEqual(heard, ['let x let'], 'onChange hears the plain value');
    assert.deepEqual(shown(box).map(s => s[0]), ['let', ' ', 'x', ' ', 'let'], "the view's answer");
    ref.setSelectionRange(1, 3);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 3], "the field's own selection");
  });

  it('shows the field plain while the runs are not its value, and during a composition', () => {
    const { window, container } = setup();
    const root = $root('app');
    const value = $signal(root, 'let x');
    const runs = $signal(root, tokens('let x'));
    render(() => <Edit value={value} runs={runs} onChange={e => $write(value, e.value)} />, container, { root });
    const input = container.querySelector('input');
    const box = input.nextSibling;
    assert.equal(box.style.display, 'flex');
    type(input, 'let xy');
    assert.equal(box.style.display, 'none', 'a draft the view has not answered: plain');
    assert.equal(input.hasAttribute('data-ren-runs'), false);
    $write(runs, tokens('let xy'));
    assert.equal(box.style.display, 'flex', 'the answer shows');
    assert.deepEqual(shown(box).map(s => s[0]), ['let', ' ', 'xy']);
    input.dispatchEvent(new window.Event('compositionstart'));
    assert.equal(box.style.display, 'none', 'a composition shows natively');
    input.dispatchEvent(new window.Event('compositionend'));
    assert.equal(box.style.display, 'flex');
    $write(runs, null);
    assert.equal(box.style.display, 'none', 'no runs: plain');
  });

  it('keeps a secret Edit plain, and a multi-line Edit mirrors in a block', () => {
    const { container } = setup();
    render(() => (
      <View>
        <Edit secret value="let" runs={tokens('let')} />
        <Edit lines={3} value="let x" runs={tokens('let x')} />
      </View>
    ), container);
    const [secret, area] = [container.querySelector('input'), container.querySelector('textarea')];
    assert.equal(secret.nextSibling.style.display, 'none');
    assert.equal(secret.hasAttribute('data-ren-runs'), false);
    assert.equal(area.nextSibling.style.display, 'block');
    assert.match(area.nextSibling.firstChild.getAttribute('style'), /white-space: pre-wrap/);
  });

  it("draws a run's background as the field's first background layer, at the run's box, so the caret and selection paint over it", () => {
    const { window, container } = setup();
    const root = $root('app');
    const value = $signal(root, 'x let');
    const own = $signal(root, /** @type {any} */ (null));
    const runs = $signal(root, tokens('x let'));
    render(() => <Edit value={value} runs={runs} style={() => $read(own)} onChange={e => $write(value, e.value)} />, container, { root });
    const input = container.querySelector('input');
    const box = input.nextSibling;
    // Laid out as a browser would (happy-dom lays nothing out): the field at 3, 4; the `let` span 10 and 5 into it.
    input.getBoundingClientRect = () => ({ x: 3, y: 4, left: 3, top: 4, right: 203, bottom: 42, width: 200, height: 38 });
    /** @type {any} */ (window.HTMLSpanElement.prototype).getClientRects = function () {
      return this.textContent === 'let' ? [{ left: 13, top: 9, right: 34, bottom: 27, width: 21, height: 18 }] : [];
    };
    input.dispatchEvent(new window.Event('focus'));
    const layers = () => ['background-image', 'background-position', 'background-size', 'background-origin', 'background-clip'].map(k => input.style.getPropertyValue(k));
    const [image, position, size, origin, clip] = layers();
    assert.match(image, /^linear-gradient\(#ffec99, #ffec99\)(, |$)/, 'the run first, the field\'s own layers behind (none computed in happy-dom)');
    assert.match(position, /^10px 5px(, |$)/);
    assert.match(size, /^21px 18px(, |$)/);
    assert.match(origin, /^border-box(, |$)/);
    assert.match(clip, /^padding-box(, |$)/, 'inside its border');
    assert.doesNotMatch(shown(box)[2][1], /background/);
    // A draft the view has not answered: plain, the field's own background back.
    type(input, 'x lets');
    assert.deepEqual(layers(), ['', '', '', '', '']);
    $write(runs, tokens('x lets'));
    // No run with a background: none.
    $write(runs, [{ text: 'x lets' }]);
    assert.deepEqual(layers(), ['', '', '', '', '']);
    // The field's own inline background stays behind the runs', and is given back.
    $write(own, { background: { linear: 90, stops: [[0, '#111111'], [1, '#222222']] } });
    const before = layers();
    $write(runs, tokens('x lets').map(r => (r.text === 'lets' ? { ...r, style: { background: '#ffec99' } } : r)));
    /** @type {any} */ (window.HTMLSpanElement.prototype).getClientRects = function () {
      return this.textContent === 'lets' ? [{ left: 13, top: 9, right: 41, bottom: 27, width: 28, height: 18 }] : [];
    };
    input.dispatchEvent(new window.Event('focus'));
    assert.match(input.style.getPropertyValue('background-image'), /^linear-gradient\(#ffec99, #ffec99\), linear-gradient\(90deg/);
    $write(runs, null);
    assert.deepEqual(layers(), before, "the field's own, as it wrote them");
  });

  it("draws a run's weight in a font that would widen it as a stroke, and its italic only in a font that keeps its advances, so the text stays under the caret", () => {
    const { window, container } = setup();
    // The stroke, which happy-dom does not keep: heard as it is written.
    /** @type {string[]} */
    const strokes = [];
    const write = window.CSSStyleDeclaration.prototype.setProperty;
    /** @type {any} */ (window.CSSStyleDeclaration.prototype).setProperty = function (/** @type {string} */ name, /** @type {string} */ value, /** @type {any} */ priority) {
      if (name === '-webkit-text-stroke') strokes.push(value);
      return write.call(this, name, value, priority);
    };
    // A canvas that measures as a browser would: monospace faces alike, others' bold wider.
    /** @type {any} */ (window.HTMLCanvasElement.prototype).getContext = () => {
      const context = { font: '', measureText: (/** @type {string} */ text) => ({ width: text.length * (/monospace/.test(context.font) || !/ 700 |italic/.test(context.font) ? 8 : 9) }) };
      return context;
    };
    /** @param {string} value */
    const slanted = value => tokens(value).map(r => (r.text === 'x' ? { text: 'x', style: { italic: true } } : r));
    render(() => (
      <View>
        <Edit value="let x" runs={slanted('let x')} style={{ fontFamily: 'monospace' }} />
        <Edit value="let x" runs={slanted('let x')} style={{ fontFamily: 'serif' }} />
      </View>
    ), container);
    // Laid out, a browser's ResizeObserver resyncs the mirrors (happy-dom's reports nothing): a focus does too.
    for (const input of container.querySelectorAll('input')) input.dispatchEvent(new window.Event('focus'));
    const [mono, serif] = [...container.querySelectorAll('[data-ren-mirror]')].map(box => shown(box));
    assert.match(mono[0][1], /font-weight: 700/, 'monospace: bold keeps its advance');
    assert.match(mono[2][1], /font-style: italic/, 'and italic');
    assert.doesNotMatch(serif[0][1], /font-weight/, "a proportional font: the field's face, the run's color");
    assert.match(serif[0][1], /color: #800080/);
    assert.deepEqual(strokes, ['0.0417em currentcolor'], 'its weight a stroke, which moves no glyph');
    assert.doesNotMatch(serif[2][1], /font-style/, 'its italic, which would, left out');
  });

  it('moves and removes a mirror with its field, which ren-core never sees', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, ['a', 'b', 'c']);
    const shown = $signal(root, true);
    render(() => (
      <View>
        <For each={items}>{item => <Edit value={item} runs={() => [{ text: item(), style: { color: '#f00' } }]} />}</For>
        <Show when={shown}>
          <Edit value="z" runs={[{ text: 'z' }]} />
        </Show>
      </View>
    ), container, { root });
    const order = () => [...container.firstElementChild.children].map(n => (n.tagName === 'INPUT' ? n.value : `~${n.textContent}`)).join(' ');
    assert.equal(order(), 'a ~a b ~b c ~c z ~z');
    $write(items, ['c', 'a', 'b']);
    assert.equal(order(), 'c ~c a ~a b ~b z ~z', 'each mirror stays after its field');
    $write(items, ['c', 'b']);
    assert.equal(order(), 'c ~c b ~b z ~z');
    $write(shown, false);
    assert.equal(order(), 'c ~c b ~b');
    $write(items, []);
    assert.equal(order(), '', 'a cleared list takes its mirrors');
    $write(items, ['d', 'e']);
    $write(shown, true);
    assert.equal(order(), 'd ~d e ~e z ~z');
  });
});
