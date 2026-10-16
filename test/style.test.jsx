// The portable style on the DOM: ren-core's vocabulary written as CSS, the box
// model's defaults on every primitive, state styles as classes, and the
// shorthand props a style overrides.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write, $dispose } from 'rrx-core';
import { View, Layout, Scroll, Label, Edit, Action, Shape, Image, Root, Recover, $focus, $active } from 'ren-core';
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
/** The inline declarations of an element, read by property name ('' reads as undefined). @param {any} el */
const declared = el => /** @type {Record<string, string | undefined>} */ (new Proxy({}, { get: (_, name) => el.style.getPropertyValue(String(name)) || undefined }));

describe('ren dom portable style', () => {
  it('wraps a Label breaking a word only where it overflows, so its min-content is its longest word, as on the canvases', () => {
    const { container } = setup();
    const root = $root('wrap');
    const lines = $signal(root, 0);
    /** @type {any[]} */
    const labels = [];
    render(() => (
      <View>
        <Label ref={(/** @type {any} */ n) => labels.push(n)} wrap text="a long word" />
        <Label ref={(/** @type {any} */ n) => labels.push(n)} text="a long word" style={{ wrap: true }} />
        <Label ref={(/** @type {any} */ n) => labels.push(n)} text="a long word" lines={() => $read(lines) || undefined} />
      </View>
    ), container, { root });
    $write(lines, 2);
    assert.deepEqual(labels.map(l => l.style.getPropertyValue('overflow-wrap')), ['break-word', 'break-word', 'break-word']);
  });

  it("lets a Recover catch a throw from a Label run's onPress: the click does not throw", () => {
    const { container } = setup();
    /** @type {any} */
    let label = null;
    render(() => (
      <Recover fallback={() => <Label text="failed" />}>
        <Label ref={(/** @type {any} */ el) => (label = el)} runs={[{ text: 'see ' }, { text: 'docs', onPress: () => { throw new Error('x'); } }]} />
      </Recover>
    ), container);
    assert.doesNotThrow(() => label.children[1].click());
    assert.equal(container.textContent, 'failed');
  });

  it('gives every primitive the box model defaults', () => {
    const { container } = setup();
    render(() => (
      <View>
        <Label text="a" />
        <Scroll />
        <Edit label="Name" value="" />
      </View>
    ), container);
    const [view, label, scroll, edit] = [...container.querySelectorAll('[data-ren]')].map(declared);
    for (const d of [view, label, scroll, edit]) {
      assert.equal(d['box-sizing'], 'border-box');
      assert.equal(d.position, 'relative', 'the containing block of its absolute children, painted in tree order');
      assert.equal(d['flex-shrink'], undefined, "shrinking and minimum sizes are the browser's own");
      assert.equal(d['min-width'] === undefined || d === edit, true);
    }
    assert.equal(edit['min-width'], 'var(--ren-entry, 200px)', "an Edit is the theme's entry width at least");
    assert.equal(edit['min-height'], 'var(--ren-field, 38px)', 'and a field high');
    assert.equal(view.display, 'flex');
    assert.equal(view['flex-direction'], 'column');
    assert.equal(view.overflow, undefined, 'a View does not scroll');
    assert.equal(scroll.overflow, 'auto');
    assert.equal(label['white-space'], 'pre', 'one line that keeps its line breaks');
    assert.equal(container.querySelector('input').getAttribute('size'), '1', "an Edit's width comes from the theme");
  });

  it("sets a root's text in the canvases' fonts when given them", () => {
    // The DOM drew rui-show's page font (Liberation Sans in Chrome) where the
    // canvases draw DejaVu Sans, 13.6% wider; with the same face, Chrome's
    // kerning still made a sentence 0.84 px narrower at 16 px.
    const { window, document, container } = setup();
    /** @type {any[]} */
    const added = [];
    const fonts = { add: (/** @type {any} */ f) => added.push(f), delete: (/** @type {any} */ f) => added.splice(added.indexOf(f), 1) };
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    /** @type {any} */ (window).FontFace = class {
      /** @param {string} family @param {any} source */
      constructor(family, source) {
        this.family = family;
        this.source = source;
      }
      load() {
        return Promise.resolve(this);
      }
    };
    const bytes = new Uint8Array([0, 1, 0, 0]);
    const root = Root({
      id: 'typed',
      target: container,
      renderer: $dom(document, { font: bytes, mono: './mono.ttf' }),
      children: (
        <View>
          <Label text="code" style={{ fontFamily: 'Menlo, monospace' }} />
          <Label text="prose" style={{ fontFamily: 'Georgia, serif' }} />
        </View>
      ),
    });
    const host = container.firstChild;
    assert.deepEqual(added.map(f => [f.family, f.source]), [['ren-typed', bytes], ['ren-typed-mono', 'url("./mono.ttf")']]);
    assert.match(host.style.getPropertyValue('font-family'), /^"?ren-typed"?, sans-serif$/);
    assert.equal(host.style.getPropertyValue('--ren-mono'), '"ren-typed-mono", monospace');
    assert.equal(host.style.getPropertyValue('font-kerning'), 'none', 'advances alone, as the canvases measure');
    assert.equal(host.style.getPropertyValue('font-variant-ligatures'), 'none');
    const [code, prose] = container.querySelectorAll('[data-ren="Label"]');
    assert.equal(code.style.getPropertyValue('font-family'), 'var(--ren-mono, Menlo, monospace)');
    assert.equal(prose.style.getPropertyValue('font-family'), 'Georgia, serif');
    $dispose(root);
    assert.equal(added.length, 0, 'its faces leave the document with it');
    assert.equal(host.style.getPropertyValue('font-family'), '');
  });

  it("keeps a Scroll's bar room as the canvases do: the theme's bar, always", () => {
    // ren-canv keeps a bar of the theme's width (8) beside a Scroll's content
    // whether or not it overflows; Chrome's overflow: auto took its 15 px bar
    // only while overflowing (-8 and +7 px on the content's width).
    const { document, container } = setup();
    Root({
      id: 'bars',
      target: container,
      renderer: $dom(document),
      children: (
        <View>
          <Scroll />
          <Scroll axis="x" />
        </View>
      ),
    });
    const [down, across] = [...container.querySelectorAll('[data-ren="Scroll"]')].map(declared);
    assert.equal(down['scrollbar-gutter'], 'stable');
    assert.equal(across['scrollbar-gutter'], 'auto', 'a Scroll across keeps no room at its side');
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    assert.match(sheet, /\[data-ren="Scroll"\][^{]*::-webkit-scrollbar \{ width: var\(--ren-bar-size, var\(--ren-bar\)\); height: var\(--ren-bar-size, var\(--ren-bar\)\); \}/, "the theme's bar unless the style's scrollbarWidth says");
    assert.match(sheet, /::-webkit-scrollbar-thumb \{ background: var\(--ren-thumb, var\(--ren-muted\)\)/, "the canvases' thumb unless the style's scrollbarColor says");
  });

  it('reads only theme tokens the root sets, so every var() in its sheet resolves', () => {
    // A rename once turned var(--ren-canvas) into var(--ren-canv): every DOM root lost its background.
    const { document, container } = setup();
    Root({ id: 'tokens', target: container, renderer: $dom(document), children: <View /> });
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    const host = container.querySelector('[data-ren-root]');
    // Those without a fallback must be set; a fallback covers the rest (--ren-placeholder, …).
    const used = [...sheet.matchAll(/var\((--ren-[\w-]+)\)/g)].map(m => m[1]);
    assert.ok(used.includes('--ren-canvas'), 'the root takes the canvas color');
    assert.deepEqual([...new Set(used)].filter(name => host.style.getPropertyValue(name) === ''), [], 'every token the sheet reads is set');
  });

  it('gives a browser without ::-webkit-scrollbar (Firefox) the standard scrollbar, leaving Blink and WebKit theirs', () => {
    const { document, container } = setup();
    const renderer = $dom(document);
    const root = Root({ id: 'bars', target: container, renderer, children: <Scroll /> });
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    const at = sheet.indexOf('@supports not selector(::-webkit-scrollbar) {');
    assert.ok(at >= 0, 'only where the browser has no ::-webkit-scrollbar');
    const block = sheet.slice(at, sheet.indexOf('}\n}', at) + 3);
    assert.match(block, /\[data-ren="Scroll"\][^{]*\{ scrollbar-width: var\(--ren-bars, var\(--ren-scrollbar, thin\)\); scrollbar-color: var\(--ren-thumb, var\(--ren-muted\)\) var\(--ren-track, var\(--ren-soft\)\); \}/, "the canvases' thumb on their track, or the style's");
    // Chrome 121+ drops its ::-webkit-scrollbar look where either standard property is set: none outside the block.
    assert.equal(sheet.replace(block, '').includes('scrollbar-width'), false);
    assert.equal(sheet.replace(block, '').includes('scrollbar-color'), false);
    const host = container.querySelector('[data-ren-root]');
    assert.equal(host.style.getPropertyValue('--ren-scrollbar'), 'thin', "the theme's 8 px bar: thin");
    /** @type {any} */ (renderer).setTheme({ bar: 14 });
    assert.equal(host.style.getPropertyValue('--ren-scrollbar'), 'auto', 'a wider bar: the platform width');
    $dispose(root);
    assert.equal(host.style.getPropertyValue('--ren-scrollbar'), '');
  });

  it("writes a Scroll's scrollbarWidth and scrollbarColor for the sheet's bars: its own width, inherited colors", () => {
    const { document, container } = setup();
    const root = Root({
      id: 'bars',
      target: container,
      renderer: $dom(document),
      children: (
        <View style={{ scrollbarColor: ['#f00', 0xff0000ff] }}>
          <Scroll style={{ scrollbarWidth: 'thin' }}><Scroll /></Scroll>
          <Scroll style={{ scrollbarWidth: 'none', scrollbarColor: 'auto' }} />
          <Scroll style={{ scrollbarWidth: 'auto', scrollbarColor: /** @type {any} */ (['#f00']) }} />
        </View>
      ),
    });
    const [view] = container.querySelectorAll('[data-ren="View"]');
    const [thin, inner, none, auto] = container.querySelectorAll('[data-ren="Scroll"]');
    const props = (/** @type {any} */ el) => ['--ren-bar-size', '--ren-bars', '--ren-thumb', '--ren-track'].map(k => el.style.getPropertyValue(k));
    assert.deepEqual(props(view), ['', '', '#f00', 'rgba(0, 0, 255, 1)'], 'the colors where the style sets them, inherited below');
    assert.deepEqual(props(thin).slice(0, 2), ['calc(var(--ren-bar) / 2)', 'thin']);
    assert.deepEqual(props(inner), ['', '', '', ''], 'a nested Scroll sets none: the sheet starts its width again');
    assert.deepEqual(props(none).slice(0, 2), ['0px', 'none']);
    assert.deepEqual(props(auto), ['', '', '', ''], "auto: the theme's bar; a color pair it cannot read sets none");
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    assert.match(sheet, /\[data-ren="Scroll"\][^{]*\{ --ren-bar-size: initial; --ren-bars: initial; \}/, 'a Scroll starts from the theme\'s width, not its parent\'s');
    assert.match(sheet, /::-webkit-scrollbar \{ width: var\(--ren-bar-size, var\(--ren-bar\)\); height: var\(--ren-bar-size, var\(--ren-bar\)\); \}/);
    assert.match(sheet, /::-webkit-scrollbar-thumb \{ background: var\(--ren-thumb, var\(--ren-muted\)\) padding-box;/);
    assert.match(sheet, /::-webkit-scrollbar-track \{ background: var\(--ren-track, var\(--ren-soft\)\); \}/);
    $dispose(root);
  });

  it('lays an Action out as the canvases do: a column flex box, its content centered', () => {
    // ren-canv lays an Action holding content out as a View, centered along its
    // main axis; a plain button stacked it as blocks (Chrome: a Checkbox's label
    // 20 px under its box, a row Action's icon above its text).
    const { container } = setup();
    const root = $root('actions');
    const shown = $signal(root, true);
    render(() => (
      <View>
        <Action text="Save" />
        <Action style={{ direction: 'row', gap: 6 }} hidden={() => !$read(shown)}>
          <View />
          <Label text="Row" />
        </Action>
      </View>
    ), container, { root });
    const [plain, row] = [...container.querySelectorAll('[data-ren="Action"]')];
    const [p, r] = [plain, row].map(declared);
    assert.deepEqual([p.display, p['flex-direction'], p['justify-content']], ['flex', 'column', 'center']);
    assert.deepEqual([r.display, r['flex-direction'], r.gap], ['flex', 'row', '6px'], "a style's direction applies");
    $write(shown, false);
    assert.equal(row.style.display, 'none');
    $write(shown, true);
    assert.equal(row.style.display, 'flex', 'shown again as a flex box');
  });

  it('writes the vocabulary as CSS', () => {
    const { container } = setup();
    render(() => (
      <View
        style={{
          direction: 'row', wrap: true, gap: 6, padding: [4, 8], margin: [1, 2, 3, 4], width: 300, maxHeight: 90, grow: 1, shrink: 1,
          align: 'center', justify: 'between', overflow: 'hidden', background: '#336699', color: 'rgba(0, 0, 0, 0.5)', opacity: 0.9,
          border: 2, borderColor: '#000', radius: 8, shadow: { y: 2, blur: 6, color: '#00000040' }, fontSize: 20, fontWeight: 'bold',
          italic: true, textAlign: 'center', lineHeight: 1.2, underline: true, select: 'none',
        }}
      >
        <Label text="wraps" style={{ wrap: true, self: 'end' }} />
      </View>
    ), container);
    const view = declared(container.firstChild);
    assert.deepEqual(
      {
        dir: view['flex-direction'], wrap: view['flex-wrap'], gap: view.gap, pt: view['padding-top'], pr: view['padding-right'], ml: view['margin-left'],
        width: view.width, maxh: view['max-height'], grow: view['flex-grow'], shrink: view['flex-shrink'], align: view['align-items'],
        justify: view['justify-content'], overflow: view.overflow, bg: view.background, color: view.color, opacity: view.opacity,
        bw: view['border-width'], bs: view['border-style'], radius: view['border-radius'], shadow: view['box-shadow'], size: view['font-size'],
        weight: view['font-weight'], italic: view['font-style'], text: view['text-align'], line: view['line-height'], deco: view['text-decoration'],
        select: view['user-select'],
      },
      {
        dir: 'row', wrap: 'wrap', gap: '6px', pt: '4px', pr: '8px', ml: '4px', width: '300px', maxh: '90px', grow: '1', shrink: '1',
        align: 'center', justify: 'space-between', overflow: 'hidden', bg: '#336699', color: 'rgba(0, 0, 0, 0.5)', opacity: '0.9',
        bw: '2px', bs: 'solid', radius: '8px', shadow: '0px 2px 6px #00000040', size: '20px', weight: '700', italic: 'italic',
        text: 'center', line: '1.2', deco: 'underline', select: 'none',
      },
    );
    const label = declared(container.querySelector('[data-ren="Label"]'));
    assert.equal(label['white-space'], 'pre-wrap', 'a Label wraps its words');
    assert.equal(label['align-self'], 'flex-end');
  });

  it('leaves a wrap that is not a flag unset, as the canvases do', () => {
    // rui-show's Glider demo wrote wrap: 'wrap': one row on Skia, two on the DOM.
    const { container } = setup();
    render(() => <View style={{ direction: 'row', wrap: /** @type {any} */ ('wrap') }} />, container);
    assert.equal(declared(container.firstChild)['flex-wrap'], undefined);
  });

  it('writes one radius or four corners as border-radius', () => {
    const { container } = setup();
    render(() => (
      <View>
        <View style={{ radius: [8, 0, 4, 2] }} />
        <View style={{ radius: 6 }} />
      </View>
    ), container);
    const [four, one] = [...container.firstChild.children].map(declared);
    assert.equal(four['border-radius'], '8px 0px 4px 2px');
    assert.equal(one['border-radius'], '6px');
  });

  it('writes a border per side, its colors and its style', () => {
    const { container } = setup();
    render(() => (
      <View>
        <View style={{ borderBottom: 2, borderLeft: 4, borderColor: '#000', borderLeftColor: '#f00', borderStyle: 'dashed' }} />
        <View style={{ borderStyle: 'dotted', border: 1 }} />
      </View>
    ), container);
    const [sides, all] = [...container.firstChild.children].map(declared);
    assert.deepEqual(
      [sides['border-bottom-width'], sides['border-bottom-style'], sides['border-left-width'], sides['border-left-color'], sides['border-top-style'], sides['border-style']],
      ['2px', 'dashed', '4px', '#f00', undefined, undefined],
    );
    assert.equal(sides['border-color'], '#000 #000 #000 #f00', "a side's color after the shorthand");
    assert.equal(all['border-style'], 'dotted');
    assert.equal(all['border-width'], '1px');
  });

  it('writes a gradient background as CSS gradients', () => {
    const { container } = setup();
    render(() => (
      <View>
        <View style={{ background: { linear: 90, stops: [[0, '#f00'], [1, 0xff0000ff]] } }} />
        <View style={{ background: { radial: true, stops: [[0, '#fff'], [0.25, '#000']] } }} />
      </View>
    ), container);
    const [linear, radial] = [...container.firstChild.children];
    assert.equal(linear.getAttribute('style').match(/background: ([^;]*)/)[1], 'linear-gradient(90deg, #f00 0%, rgba(0, 0, 255, 1) 100%)');
    assert.equal(radial.getAttribute('style').match(/background: ([^;]*)/)[1], 'radial-gradient(circle farthest-corner at center, #fff 0%, #000 25%)');
  });

  it('writes transforms as CSS translate, rotate, scale and transform-origin', () => {
    const { container } = setup();
    render(() => <Label text="axis" style={{ rotate: -90, scale: [2, 1], translate: [4, '50%'], transformOrigin: [0, '100%'] }} />, container);
    const label = declared(container.firstChild);
    assert.deepEqual([label.rotate, label.scale, label.translate, label['transform-origin']], ['-90deg', '2 1', '4px 50%', '0px 100%']);
  });

  it("writes skews as CSS's transform, after the other transforms", () => {
    const { container } = setup();
    const skew = $root('skew');
    const s = $signal(skew, /** @type {any} */ ({ skewX: 20, rotate: 45 }));
    render(() => <Label text="lean" style={s} />, container, { root: skew });
    const label = declared(container.firstChild);
    assert.deepEqual([label.transform, label.rotate], ['skew(20deg, 0deg)', '45deg']);
    $write(s, { skewY: -10 });
    assert.equal(declared(container.firstChild).transform, 'skew(0deg, -10deg)');
    $write(s, {});
    assert.equal(declared(container.firstChild).transform, undefined, 'none once the style stops');
  });

  it("writes a Label's runs as spans in their own style, inheriting the Label's", () => {
    const { container } = setup();
    const R = $root('runs');
    /** @type {any} */
    const list = $signal(R, [
      { text: 'plain ' },
      { text: 'mark', style: { background: '#ffec99', fontWeight: 700, italic: true, color: 0xff112233 } },
      { text: ' code', style: { fontFamily: 'monospace', fontSize: 12, underline: true, strike: true } },
    ]);
    /** @type {string[]} */
    const pressed = [];
    render(() => <Label runs={list} style={{ wrap: true }} lines={2} onPress={() => pressed.push('label')} />, container, { root: R });
    const label = container.firstChild;
    assert.equal(label.textContent, 'plain mark code', "the Label's text is its runs' joined");
    const [plain, mark, code] = [...label.children];
    assert.equal(plain.getAttribute('style'), null, 'a run without a style inherits all');
    const m = declared(mark);
    assert.deepEqual([m.background, m['font-weight'], m['font-style'], m.color], ['#ffec99', '700', 'italic', 'rgba(17, 34, 51, 1)']);
    const c = declared(code);
    assert.deepEqual([c['font-family'], c['font-size'], c['text-decoration']], ['var(--ren-mono, monospace)', '12px', 'underline line-through']);
    assert.equal(label.style.getPropertyValue('line-clamp'), '2', "the clamp stays the Label's");
    $write(list, [{ text: 'see ' }, { text: 'docs', onPress: () => pressed.push('run') }]);
    assert.equal(label.textContent, 'see docs');
    label.children[1].click();
    label.children[0].click();
    assert.deepEqual(pressed, ['run', 'label', 'label'], "a run's press first, then the Label's");
  });

  it('writes aspectRatio as a unitless aspect-ratio', () => {
    const { container } = setup();
    render(() => <View style={{ width: 160, aspectRatio: 16 / 9 }} />, container);
    assert.match(String(declared(container.firstChild)['aspect-ratio']), /^1\.7777777777777777( \/ 1)?$/, 'a ratio, not a length');
  });

  it('writes font weights 100 to 900 and the font family', () => {
    const { container } = setup();
    render(() => (
      <View>
        <Label text="a" style={{ fontWeight: 500 }} />
        <Label text="b" style={{ fontWeight: 300, fontFamily: 'monospace' }} />
      </View>
    ), container);
    const [medium, light] = [...container.firstChild.children].map(declared);
    assert.equal(medium['font-weight'], '500');
    assert.equal(light['font-weight'], '300');
    assert.equal(light['font-family'], 'var(--ren-mono, monospace)', "the root's mono face where it has one, else the family");
  });

  it('writes a fixed position with its insets', () => {
    const { container } = setup();
    render(() => <View style={{ position: 'fixed', bottom: 10, right: 10 }} />, container);
    const bar = declared(container.firstChild);
    assert.deepEqual([bar.position, bar.bottom, bar.right], ['fixed', '10px', '10px']);
  });

  it('writes a sticky position with its inset', () => {
    const { container } = setup();
    render(() => <Scroll><View style={{ position: 'sticky', top: 0, zIndex: 1 }} /></Scroll>, container);
    const head = declared(container.firstChild.firstChild);
    assert.deepEqual([head.position, head.top], ['sticky', '0px']);
  });

  it('scrolls a Scroll along its axis', () => {
    const { container } = setup();
    render(() => (
      <View>
        <Scroll axis="x" />
        <Scroll axis="y" />
        <Scroll axis="both" />
      </View>
    ), container);
    const [x, y, both] = [...container.firstChild.children].map(declared);
    assert.deepEqual([x['overflow-x'], x['overflow-y']], ['auto', 'hidden']);
    assert.deepEqual([y['overflow-x'], y['overflow-y']], ['hidden', 'auto']);
    assert.deepEqual([both['overflow-x'], both['overflow-y']], ['auto', 'auto']);
  });

  it('fits an Image with object-fit and hears its load error', () => {
    const { container, window } = setup();
    /** @type {string[]} */
    const heard = [];
    render(() => <Image source="missing.png" style={{ objectFit: 'cover' }} onError={(/** @type {any} */ e) => heard.push(e.type)} />, container);
    const img = container.querySelector('img');
    assert.equal(declared(img)['object-fit'], 'cover');
    img.dispatchEvent(new window.Event('error'));
    assert.deepEqual(heard, ['error']);
  });

  it('reports a primitive\'s border box to onResize through a ResizeObserver', () => {
    const { container, window } = setup();
    /** @type {any[]} */
    const observers = [];
    /** @type {any} */ (window).ResizeObserver = class {
      /** @param {any} fn */
      constructor(fn) {
        this.fn = fn;
        /** @type {any[]} */
        this.nodes = [];
        observers.push(this);
      }
      /** @param {any} node */
      observe(node) {
        this.nodes.push(node);
      }
      /** @param {any} node */
      unobserve(node) {
        this.nodes = this.nodes.filter(n => n !== node);
      }
    };
    /** @type {string[]} */
    const heard = [];
    const root = $root('sizes');
    const on = $signal(root, true);
    render(() => <View>{() => ($read(on) ? <View onResize={(/** @type {any} */ e) => heard.push(`${e.width}x${e.height}`)} /> : null)}</View>, container, { root });
    const [observer] = observers;
    const node = container.querySelectorAll('[data-ren="View"]')[1];
    assert.ok(observer.nodes.length === 1 && observer.nodes[0] === node, 'observed');
    observer.fn([{ target: node, borderBoxSize: [{ inlineSize: 120, blockSize: 30 }] }]);
    assert.deepEqual(heard, ['120x30']);
    $write(on, false);
    assert.equal(observer.nodes.length, 0, 'unobserved when it goes');
  });

  it('keeps Tab inside a trap: the last to the first and back', () => {
    const { container, window, document } = setup();
    render(() => (
      <View>
        <Action text="out" />
        <View trap>
          <Action text="a" />
          <Action text="b" />
        </View>
      </View>
    ), container);
    const [out, a, b] = [...container.querySelectorAll('button')];
    const tab = (/** @type {boolean} */ shift) => {
      const e = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
      document.activeElement.dispatchEvent(e);
      return e.defaultPrevented;
    };
    b.focus();
    assert.ok(tab(false));
    assert.equal(document.activeElement, a, 'the last to the first');
    assert.ok(tab(true));
    assert.equal(document.activeElement, b, 'and back');
    out.focus();
    assert.ok(!tab(false), 'outside it, the browser tabs');
  });

  it('hands a focus ring on (ring false) to the element around it marked inner and those inside it marked outer, through the sheet', () => {
    const { container, document } = setup();
    /** @type {any} */
    let handed = null;
    const Page = () => {
      handed = $signal($active(), true);
      return (
        <View>
          <View style={{ ring: 'inner', radius: 6 }}>
            <Edit label="name" value="" style={() => ($read(handed) ? { ring: false } : {})} />
          </View>
          <Action style={{ ring: false }}>
            <View style={{ ring: 'outer', radius: 8 }} />
          </Action>
        </View>
      );
    };
    const root = Root({ id: 'rings', target: container, renderer: $dom(document), children: <Page /> });
    const marked = () => [...container.querySelectorAll('[data-ren-ring]')].map(n => `${n.getAttribute('data-ren')}:${n.getAttribute('data-ren-ring')}`);
    assert.deepEqual(marked(), ['View:inner', 'Edit:false', 'Action:false', 'View:outer']);
    assert.equal(container.querySelector('[data-ren="Edit"]').style.getPropertyValue('ring'), '', 'no CSS property of that name');
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    assert.match(sheet, /\[data-ren-ring="false"\]:is\(:focus, :focus-visible\)[^{]*\{ outline: none; \}/);
    assert.match(sheet, /\[data-ren-ring="inner"\]:has\(\[data-ren-ring="false"\]:focus-visible\):not\(:has\(\[data-ren-ring="false"\]:focus-visible \[data-ren-ring="outer"\]\)\):not\(:has\(\[data-ren-ring="inner"\] \[data-ren-ring="false"\]:focus-visible\)\)[^{]*\{ outline: auto; outline-offset: 0; \}/);
    assert.ok(!/:has\([^)]*:has\(/.test(sheet), 'no :has inside :has, which CSS refuses');
    assert.match(sheet, /\[data-ren-ring="false"\]:focus-visible \[data-ren-ring="outer"\][^{]*\{ outline: auto; outline-offset: 0; \}/);
    $write(handed, false);
    assert.deepEqual(marked(), ['View:inner', 'Action:false', 'View:outer'], 'a style without it gives the ring back');
    $dispose(root);
  });

  it('takes the focus back into a trap when the focused element inside it is removed', () => {
    const { container, document, window } = setup();
    const root = $root('trap');
    const shown = $signal(root, true);
    /** @type {string[]} */
    const keys = [];
    render(() => (
      <View>
        <Action text="out" />
        <View trap onKey={(/** @type {any} */ e) => keys.push(e.key)}>
          <Action text="first" />
          {() => ($read(shown) ? <Action text="swap" /> : <Label text="swapped" />)}
        </View>
        <View trap tabIndex={-1}>
          {() => ($read(shown) ? <Action text="only" /> : null)}
        </View>
      </View>
    ), container, { root });
    const [, first, swap] = [...container.querySelectorAll('button')];
    const [, trap, bare] = [...container.querySelectorAll('[data-ren="View"]')];
    swap.focus();
    $write(shown, false);
    assert.ok(document.activeElement === first, "the trap's first focusable");
    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.deepEqual(keys, ['Escape'], 'its keys still reach the trap');
    assert.ok(trap.contains(document.activeElement));
    $write(shown, true);
    container.querySelectorAll('button')[3].focus();
    $write(shown, false);
    assert.ok(document.activeElement === bare, 'none inside: the trap itself, which takes the focus');
    $dispose(root);
  });

  it('focuses the first or last focusable inside a trap with $focus, as Tab cycles', () => {
    const { container, document } = setup();
    /** @type {any} */
    let trap = null;
    render(() => (
      <View>
        <Action text="out" />
        <View trap ref={(/** @type {any} */ n) => (trap = n)}>
          <Label text="title" />
          <Edit label="first" value="" disabled />
          <View hidden>
            <Action text="hidden" />
          </View>
          <Edit label="name" value="" />
          <Action text="save" />
        </View>
      </View>
    ), container);
    assert.equal($focus(trap), true);
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'name', 'the first enabled and shown');
    assert.equal($focus(trap, true), true);
    assert.equal(document.activeElement?.textContent, 'save');
    assert.equal($focus(container.querySelector('[data-ren="Label"]')), false, 'none inside a Label');
  });

  it('writes tabindex and inert, which the browser and $focus follow', () => {
    const { container, document } = setup();
    const root = $root('app');
    const off = $signal(root, true);
    const index = $signal(root, /** @type {number | null} */ (-1));
    /** @type {any} */
    let main = null;
    /** @type {any} */
    let all = null;
    render(() => (
      <View ref={(/** @type {any} */ n) => (all = n)}>
        <Action text="skip" tabIndex={-1} />
        <View ref={(/** @type {any} */ n) => (main = n)} tabIndex={index}>
          <View inert={off}>
            <Action text="hidden from input" />
          </View>
          <Action text="go" />
        </View>
      </View>
    ), container, { root });
    const [skip] = container.querySelectorAll('[data-ren="Action"]');
    assert.equal(skip.getAttribute('tabindex'), '-1', 'an Action out of the Tab order');
    assert.equal(main.getAttribute('tabindex'), '-1', 'a region focusable from code');
    main.focus();
    assert.equal(document.activeElement, main);
    assert.equal(container.querySelectorAll('[inert]').length, 1);
    assert.equal($focus(all), true);
    assert.equal(document.activeElement?.textContent, 'go', 'nothing in the inert region, nor the -1 Action, is the first');
    $write(off, false);
    $write(index, null);
    assert.equal(container.querySelectorAll('[inert]').length, 0, 'not inert: the attribute goes');
    assert.equal(main.hasAttribute('tabindex'), false, 'unset: the attribute goes');
    assert.equal($focus(all), true);
    assert.equal(document.activeElement?.textContent, 'hidden from input');
  });

  it('writes dir, which the browser lays out and sets text in, and takes it away when unset', () => {
    const { container } = setup();
    const root = $root('app');
    const dir = $signal(root, /** @type {string | null} */ ('rtl'));
    render(() => (
      <View dir={() => /** @type {any} */ ($read(dir))}>
        <Edit dir="auto" />
        <Label text="abc" />
      </View>
    ), container, { root });
    const [view, edit] = [container.querySelector('[data-ren="View"]'), container.querySelector('input')];
    assert.equal(view.getAttribute('dir'), 'rtl');
    assert.equal(edit.getAttribute('dir'), 'auto');
    assert.equal(container.querySelector('[data-ren="Label"]').hasAttribute('dir'), false, 'inherited, not written');
    $write(dir, 'ltr');
    assert.equal(view.getAttribute('dir'), 'ltr');
    $write(dir, null);
    assert.equal(view.hasAttribute('dir'), false, 'unset: the attribute goes');
  });

  it('hears files dropped on a primitive, and accepts the drag over it', () => {
    const { container, window } = setup();
    /** @type {any[]} */
    const heard = [];
    render(() => <View onDrop={(/** @type {any} */ e) => heard.push(e.files.map((/** @type {any} */ f) => f.name))} />, container);
    const zone = container.firstChild;
    const over = new window.Event('dragover', { bubbles: true, cancelable: true });
    zone.dispatchEvent(over);
    assert.ok(over.defaultPrevented, 'the drag is accepted');
    const drop = /** @type {any} */ (new window.Event('drop', { bubbles: true, cancelable: true }));
    drop.dataTransfer = { files: [{ name: 'a.txt' }, { name: 'b.png' }] };
    zone.dispatchEvent(drop);
    assert.deepEqual(heard, [['a.txt', 'b.png']]);
    assert.ok(drop.defaultPrevented, 'the browser does not open the file');
    // An HTML element's drop stays the DOM's own event.
    /** @type {any[]} */
    const native = [];
    const { container: other, window: w2 } = setup();
    render(() => <li onDrop={(/** @type {any} */ e) => native.push(e)} />, other);
    const plain = new w2.Event('drop', { bubbles: true, cancelable: true });
    other.firstChild.dispatchEvent(plain);
    assert.ok(native[0] === plain && !plain.defaultPrevented);
  });

  it('passes a drag over a primitive as the portable drag: the files\' count and types, bubbling', () => {
    const { container, window } = setup();
    /** @type {string[]} */
    const heard = [];
    const log = (/** @type {string} */ who) => (/** @type {any} */ e) => heard.push(`${who} ${e.type} ${e.files} ${e.types.join(',')} ${e.x},${e.y} ${e.currentTarget === e.target ? 'own' : 'bubbled'}`);
    render(() => (
      <View onDragEnter={log('zone')} onDragOver={log('zone')} onDragLeave={log('zone')}>
        <View onDragEnter={log('child')} />
      </View>
    ), container);
    const zone = container.firstChild;
    const drag = (/** @type {any} */ node, /** @type {string} */ type) => {
      const e = /** @type {any} */ (new window.Event(type, { bubbles: true, cancelable: true }));
      e.dataTransfer = { items: [{ kind: 'file', type: 'image/png' }, { kind: 'string', type: 'text/uri-list' }, { kind: 'file', type: '' }] };
      Object.defineProperty(e, 'clientX', { value: 4 });
      Object.defineProperty(e, 'clientY', { value: 6 });
      node.dispatchEvent(e);
    };
    drag(zone.firstChild, 'dragenter');
    drag(zone, 'dragover');
    drag(zone, 'dragleave');
    assert.deepEqual(heard, ['child dragenter 2 image/png, 4,6 own', 'zone dragenter 2 image/png, 4,6 bubbled', 'zone dragover 2 image/png, 4,6 own', 'zone dragleave 2 image/png, 4,6 own']);
    // An HTML element's stays the DOM's own event.
    /** @type {any[]} */
    const native = [];
    render(() => <li onDragOver={(/** @type {any} */ e) => native.push(e)} />, container);
    const plain = new window.Event('dragover', { bubbles: true });
    /** @type {any} */ (container.lastChild).dispatchEvent(plain);
    assert.ok(native[0] === plain);
  });

  it('writes a strike through, with an underline too', () => {
    const { container } = setup();
    render(() => (
      <View>
        <Label text="a" style={{ strike: true }} />
        <Label text="b" style={{ strike: true, underline: true }} />
      </View>
    ), container);
    const [a, b] = [...container.firstChild.children].map(declared);
    assert.equal(a['text-decoration'], 'line-through');
    assert.equal(b['text-decoration'], 'underline line-through');
  });

  it("fills a Shape record with its fill: a color, or a gradient over its bounds", () => {
    const { container } = setup();
    render(() => (
      <Shape
        shapes={[
          { kind: 'rect', x: 0, y: 0, right: 40, bottom: 20, fill: { linear: 90, stops: [[0, '#f00'], [1, 0xff0000ff]] } },
          { kind: 'oval', x: 10, y: 10, right: 30, bottom: 30, fill: { radial: true, stops: [[0, '#fff'], [0.5, '#000']] } },
          { kind: 'path', points: [0, 0, 20, 0, 10, 10], closed: true, fill: '#0f0', color: '#00f' },
          { kind: 'rect', x: 0, y: 0, right: 5, bottom: 5, stroke: 1, fill: { linear: 0, stops: [[0, '#fff'], [1, '#000']] } },
        ]}
      />
    ), container);
    const [rect, oval, path, outline] = [...container.querySelectorAll('rect, ellipse, path')];
    const linear = container.querySelector('linearGradient');
    const radial = container.querySelector('radialGradient');
    assert.equal(rect.getAttribute('fill'), `url(#${linear.getAttribute('id')})`);
    assert.equal(linear.getAttribute('gradientUnits'), 'userSpaceOnUse');
    // 90 degrees: left to right across the box's width, through its middle.
    assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map(a => Number(linear.getAttribute(a)).toFixed(3)), ['0.000', '10.000', '40.000', '10.000']);
    assert.deepEqual([...linear.children].map(s => [s.getAttribute('offset'), s.getAttribute('stop-color')]), [['0', '#f00'], ['1', 'rgba(0, 0, 255, 1)']]);
    assert.equal(oval.getAttribute('fill'), `url(#${radial.getAttribute('id')})`);
    assert.deepEqual(['cx', 'cy', 'r'].map(a => Number(radial.getAttribute(a)).toFixed(3)), ['20.000', '20.000', (Math.sqrt(800) / 2).toFixed(3)]);
    assert.equal(path.getAttribute('fill'), '#0f0', 'a color fill in place of its color');
    assert.equal(outline.getAttribute('fill'), 'none', 'a stroke is not filled');
    assert.equal(container.querySelectorAll('linearGradient').length, 1);
  });

  it("draws a Shape without a color in the theme's ink, and a round without a radius in its radius, following setTheme", () => {
    const { document, container } = setup();
    const renderer = $dom(document, { theme: { ink: 0xff112233, radius: 9 } });
    const root = Root({
      id: 'shapes',
      target: container,
      renderer,
      children: (
        <Shape
          shapes={[
            { kind: 'round', x: 0, y: 0, right: 20, bottom: 20 },
            { kind: 'rect', x: 0, y: 0, right: 9, bottom: 9, stroke: 1 },
            { kind: 'line', x: 0, y: 0, right: 20, bottom: 0 },
            { kind: 'round', x: 0, y: 0, right: 20, bottom: 20, radius: 3, color: 0xffff0000 },
          ]}
        />
      ),
    });
    const [round, outline, line, own] = /** @type {any[]} */ ([...container.querySelectorAll('rect, line')]);
    const ink = 'var(--ren-ink, rgba(38, 62, 52, 1))';
    assert.equal(round.getAttribute('style'), `rx: var(--ren-radius, 6px); fill: ${ink};`, "a round's corner and fill follow the theme, as cssText writes them");
    assert.equal(outline.getAttribute('style'), `stroke: ${ink};`, 'a stroke too');
    assert.equal(line.getAttribute('style'), `stroke: ${ink};`, 'a line too');
    assert.equal(own.getAttribute('style'), null, 'a shape with its own color and radius keeps them');
    assert.deepEqual([own.getAttribute('fill'), own.getAttribute('rx')], ['rgba(255, 0, 0, 1)', '3']);
    assert.deepEqual([round.getAttribute('fill'), round.getAttribute('rx')], ['rgba(38, 62, 52, 1)', '6'], "the default theme's ink and radius where no custom property reaches");
    const host = container.querySelector('[data-ren-root]');
    assert.equal(host.style.getPropertyValue('--ren-ink'), 'rgba(17, 34, 51, 1)', "the root's ink, which the shapes read");
    assert.equal(host.style.getPropertyValue('--ren-radius'), '9px');
    /** @type {any} */ (renderer).setTheme({ ink: 0xff445566, radius: 2 });
    assert.equal(host.style.getPropertyValue('--ren-ink'), 'rgba(68, 85, 102, 1)', 'a new theme reaches them with no redraw');
    assert.equal(host.style.getPropertyValue('--ren-radius'), '2px');
    $dispose(root);
  });

  it('draws a Shape line as thick as its stroke, 1 by default', () => {
    const { container } = setup();
    render(() => <Shape shapes={[{ kind: 'line', x: 0, y: 0, right: 20, bottom: 0 }, { kind: 'line', x: 0, y: 5, right: 20, bottom: 5, stroke: 3 }]} />, container);
    assert.deepEqual([...container.querySelectorAll('line')].map(l => l.getAttribute('stroke-width')), ['1', '3']);
  });

  it('dashes a Shape record with dash, as SVG stroke-dasharray', () => {
    const { container } = setup();
    render(() => <Shape shapes={[{ kind: 'line', x: 0, y: 0, right: 20, bottom: 0, dash: [5, 3] }, { kind: 'rect', x: 0, y: 0, right: 9, bottom: 9, stroke: 1 }]} />, container);
    const [line, rect] = [...container.querySelectorAll('line, rect')];
    assert.equal(line.getAttribute('stroke-dasharray'), '5 3');
    assert.equal(rect.getAttribute('stroke-dasharray'), null);
    assert.equal(rect.getAttribute('fill'), 'none', 'a stroked rect is outlined');
  });

  it('lets a style override the shorthand props, and gives them back', () => {
    const { container } = setup();
    const root = $root('app');
    const look = $signal(root, /** @type {any} */ ({ padding: 12, background: '#fff' }));
    render(() => <View pad={4} fill={0xff000000} gap={3} style={look} />, container, { root });
    const view = () => declared(container.firstChild);
    assert.equal(view()['padding-top'], '12px');
    assert.equal(view().background, '#fff', 'CSS colors pass through: the browser reads them');
    assert.equal(view().gap, '3px', 'what the style leaves alone, the shorthand sets');
    $write(look, { padding: 12 });
    assert.equal(view().background, 'rgba(0, 0, 0, 1)', 'the fill comes back when the style stops setting a background');
    $write(look, null);
    assert.equal(view()['padding-top'], '4px');
  });

  it('writes placement and percent sizes as CSS, and gives the position back', () => {
    const { container } = setup();
    const root = $root('app');
    const look = $signal(root, /** @type {any} */ ({ position: 'absolute', inset: 0, top: '100%', left: -4, zIndex: 3, width: '50%', maxHeight: '25%' }));
    render(() => (
      <View>
        <View style={look} />
      </View>
    ), container, { root });
    const pop = () => declared(container.firstChild.firstChild);
    assert.deepEqual(
      { position: pop().position, top: pop().top, right: pop().right, bottom: pop().bottom, left: pop().left, z: pop()['z-index'], width: pop().width, maxh: pop()['max-height'] },
      { position: 'absolute', top: '100%', right: '0px', bottom: '0px', left: '-4px', z: '3', width: '50%', maxh: '25%' },
    );
    $write(look, { top: 6 });
    assert.equal(pop().position, 'relative', 'a style that stops setting the position gives the base back');
    assert.equal(pop().top, '6px');
    assert.equal(pop()['z-index'], undefined);
    assert.equal(pop().left, undefined);
  });

  it('writes hover, press and focus styles as one shared class per rule set', () => {
    const { container, document } = setup();
    const hover = { background: '#eee', hover: { background: '#ddd' }, press: { background: '#ccc' }, focus: { border: 2 } };
    render(() => (
      <View>
        <Action text="a" style={hover} />
        <Action text="b" style={hover} />
      </View>
    ), container);
    const [a, b] = [...container.querySelectorAll('button')];
    const name = a.getAttribute('data-ren-state');
    assert.ok(name && a.classList.contains(name));
    assert.equal(b.getAttribute('data-ren-state'), name, 'the same rules share one class');
    const sheet = document.querySelector('style[data-ren-states]').textContent;
    assert.match(sheet, new RegExp(`\\.${name}:hover \\{ background: #ddd !important \\}`));
    assert.match(sheet, new RegExp(`\\.${name}:active`));
    assert.match(sheet, new RegExp(`\\.${name}:focus \\{ border-width: 2px !important; border-style: solid !important \\}`));
  });

  it('keeps each root\'s state classes its own when two share a document', () => {
    const { document } = setup();
    const [a, b] = [document.createElement('div'), document.createElement('div')];
    document.body.append(a, b);
    Root({ id: 'one', target: a, renderer: $dom(document), children: <View style={{ hover: { background: 'red' } }} /> });
    Root({ id: 'two', target: b, renderer: $dom(document), children: <View style={{ hover: { background: 'blue' } }} /> });
    const [x, y] = [a, b].map(host => host.querySelector('[data-ren="View"]').getAttribute('data-ren-state'));
    assert.notEqual(x, y, 'each root names its own classes');
    for (const [host, name, color] of [[a, x, 'red'], [b, y, 'blue']]) {
      const rules = [...document.querySelectorAll('style[data-ren-states]')].map(s => s.textContent).join('').split('\n').filter(r => r.startsWith(`.${name}:`));
      assert.deepEqual(rules, [`.${name}:hover { background: ${color} !important }`], `${host === a ? 'one' : 'two'} keeps its hover`);
    }
  });

  it('removes the state sheet a view without a root made, when it is disposed', () => {
    const { document } = setup();
    for (let k = 0; k < 3; k++) {
      const box = document.createElement('div');
      document.body.appendChild(box);
      render(() => <View style={{ hover: { background: k === 0 ? 'red' : 'blue' } }} />, box)();
      box.remove();
    }
    assert.equal(document.querySelectorAll('style[data-ren-states]').length, 0, 'no stale sheet in the document');
  });

  it('names the state classes and anchors of a view without a root apart from any root\'s', () => {
    const { document, container } = setup();
    const other = document.createElement('div');
    document.body.appendChild(other);
    render(() => <Edit value="x y" runs={[{ text: 'x y' }]} style={{ hover: { background: 'red' } }} />, container);
    Root({ id: 'h1', target: other, renderer: $dom(document), children: <Edit value="x y" runs={[{ text: 'x y' }]} style={{ hover: { background: 'blue' } }} /> });
    const [p, q] = [container, other].map(c => c.querySelector('input'));
    assert.notEqual(p.style.getPropertyValue('anchor-name'), q.style.getPropertyValue('anchor-name'), 'a root named h1 takes no unrooted anchor');
    assert.notEqual(p.getAttribute('data-ren-state'), q.getAttribute('data-ren-state'));
  });

  it('writes a grid as CSS grid', () => {
    const { container } = setup();
    render(() => (
      <View style={{ display: 'grid', columns: [100, '1fr'], rows: 'repeat(2, 40px)', columnGap: 4, rowGap: 6 }}>
        <Label text="a" style={{ column: '1 / 3', row: 2 }} />
      </View>
    ), container);
    const grid = declared(container.firstChild);
    assert.equal(grid.display, 'grid');
    assert.equal(grid['grid-template-columns'], '100px 1fr');
    assert.equal(grid['grid-template-rows'], 'repeat(2, 40px)');
    assert.equal(grid['column-gap'], '4px');
    assert.equal(grid['row-gap'], '6px');
    const label = declared(container.querySelector('[data-ren="Label"]'));
    assert.equal(label['grid-column'], '1 / 3');
    assert.equal(label['grid-row'], '2');
  });

  it('writes touchAction as touch-action, and textTransform as text-transform but on an Edit', () => {
    const { container } = setup();
    render(() => (
      <View style={{ touchAction: 'pan-y pinch-zoom', textTransform: 'uppercase' }}>
        <Label text="a" style={{ textTransform: 'capitalize', touchAction: 'none' }} />
        <Edit value="typed" style={{ textTransform: 'uppercase' }} />
        <Action text="go" style={{ textTransform: 'lowercase' }} />
        <Label text="b" style={{ textTransform: /** @type {any} */ ('small-caps') }} />
      </View>
    ), container);
    const [view, label, edit, action, other] = [...container.querySelectorAll('[data-ren]')].map(declared);
    assert.equal(view['touch-action'], 'pan-y pinch-zoom');
    assert.equal(view['text-transform'], 'uppercase');
    assert.equal(label['touch-action'], 'none');
    assert.equal(label['text-transform'], 'capitalize');
    assert.equal(edit['text-transform'], undefined, 'an Edit shows its value as typed, as on the canvases');
    assert.equal(action['text-transform'], 'lowercase');
    assert.equal(other['text-transform'], undefined, 'not in the vocabulary');
  });

  it('writes display contents on a container: no box, its children its parent\'s; a leaf ignores it', () => {
    const { container } = setup();
    render(() => (
      <View style={{ display: 'grid', columns: '1fr 1fr' }}>
        <View role="row" style={{ display: 'contents', background: '#fff' }}>
          <Label role="cell" text="a" />
          <Label role="cell" text="b" />
        </View>
        <Label style={{ display: 'contents' }} text="c" />
      </View>
    ), container);
    const [, row, , , label] = [...container.querySelectorAll('[data-ren]')];
    assert.equal(row.getAttribute('role'), 'row');
    assert.equal(declared(row).display, 'contents');
    assert.equal(declared(label).display, 'block', 'a leaf keeps its box, as on the canvases');
  });

  it('writes datetime as an attribute, as HTML\'s time', () => {
    const { container } = setup();
    render(() => <Label role="time" datetime="2026-09-27T10:00Z" text="this morning" />, container);
    assert.equal(container.firstChild.getAttribute('datetime'), '2026-09-27T10:00Z');
  });

  it('passes names outside the vocabulary through as CSS, the DOM only', () => {
    const { container } = setup();
    render(() => <Label text="x" style={{ cursor: 'pointer', letterSpacing: 2 }} />, container);
    const label = declared(container.firstChild);
    assert.equal(label.cursor, 'pointer');
    assert.equal(label['letter-spacing'], '2px');
  });

  it("sets an application root's text tokens: the leading without a unit", () => {
    const { document } = setup();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = Root({ id: 'app', target: host, renderer: $dom(document, { theme: { text: 15 } }), children: () => <Layout><Label text="x" /></Layout> });
    const el = document.querySelector('[data-ren-root="app"]');
    assert.equal(el.style.getPropertyValue('--ren-text'), '15px');
    assert.equal(el.style.getPropertyValue('--ren-leading'), '1.4');
    assert.equal(el.style.getPropertyValue('--ren-entry'), '200px');
    void root;
  });

  it('gives a primitive its display back when hidden is false or undefined', () => {
    const { container } = setup();
    const root = $root('hide');
    const hidden = $signal(root, /** @type {boolean | undefined} */ (true));
    render(() => (
      <View>
        <View hidden={false}><Label text="a" hidden={undefined} /></View>
        <View hidden={hidden} style={{ display: 'grid' }} />
        <View hidden={hidden} />
      </View>
    ), container, { root });
    const [, shown, grid, toggled] = container.querySelectorAll('[data-ren=View]');
    assert.equal(shown.style.display, 'flex');
    assert.equal(container.querySelector('[data-ren=Label]').style.display, 'block');
    assert.equal(grid.style.display, 'none');
    assert.equal(toggled.style.display, 'none');
    $write(hidden, undefined);
    assert.equal(grid.style.display, 'grid', "its style's display");
    assert.equal(toggled.style.display, 'flex');
    $write(hidden, true);
    assert.equal(toggled.style.display, 'none');
  });
  it('writes a style number in px, bare only for a unitless property, the same through View and the style prop', () => {
    const { container } = setup();
    const root = $root('app');
    const look = $signal(root, /** @type {any} */ ('color: red; padding: 3px'));
    render(() => (
      <div>
        <View style={{ borderWidth: 2, borderTopLeftRadius: 4, flexBasis: 100, columnCount: 2, lineHeight: 1.5, fontSizeAdjust: 0.5 }} />
        <p style={{ borderWidth: 2, borderTopLeftRadius: 4, flexBasis: 100, columnCount: 2, fontSizeAdjust: 0.5, 'margin-top': 4, 'z-index': 2, '--gap': 5 }} />
        <p style={() => $read(look)} />
      </div>
    ), container, { root });
    const [view] = [...container.querySelectorAll('[data-ren]')].map(declared);
    assert.equal(view['border-width'], '2px', 'a key holding "order" is still a length');
    assert.equal(view['border-top-left-radius'], '4px');
    assert.equal(view['flex-basis'], '100px', 'a key holding "flex" is still a length');
    assert.equal(view['column-count'], '2', 'a unitless property is bare');
    assert.equal(view['line-height'], '1.5');
    assert.equal(view['font-size-adjust'], '0.5');
    // (happy-dom keeps no vendor-prefixed property: ren-html's tests check WebkitLineClamp.)
    const plain = declared(container.querySelectorAll('p')[0]);
    assert.equal(plain['border-width'], '2px');
    assert.equal(plain['border-top-left-radius'], '4px');
    assert.equal(plain['flex-basis'], '100px');
    assert.equal(plain['column-count'], '2');
    assert.equal(plain['font-size-adjust'], '0.5');
    assert.equal(plain['margin-top'], '4px', 'a kebab key takes px too');
    assert.equal(plain['z-index'], '2', 'and is unitless by its camelCase name');
    assert.equal(plain['--gap'], '5', 'a custom property is written as given');
    // A string, then an object: the string's declarations go.
    const shifted = /** @type {any} */ (container.querySelectorAll('p')[1]);
    assert.equal(shifted.style.getPropertyValue('padding-top'), '3px');
    $write(look, { color: 'blue' });
    assert.equal(shifted.getAttribute('style'), 'color: blue;');
    $write(look, { margin: 1 });
    assert.equal(shifted.getAttribute('style'), 'margin: 1px;');
  });
  it('writes a lowercase webkit key (CSSOM\'s webkitLineClamp) as -webkit-line-clamp', () => {
    const { window, container } = setup();
    // happy-dom keeps no vendor-prefixed property: the names written are recorded instead.
    const proto = Object.getPrototypeOf(window.document.createElement('p').style);
    const setProperty = proto.setProperty;
    /** @type {string[]} */
    const written = [];
    proto.setProperty = function (/** @type {string} */ name, /** @type {string} */ value, /** @type {any[]} */ ...rest) {
      written.push(`${name}: ${value}`);
      return setProperty.call(this, name, value, ...rest);
    };
    try {
      render(() => <div><View style={{ webkitLineClamp: 2 }} /><p style={{ webkitLineClamp: 3, WebkitBoxOrient: 'vertical' }} /></div>, container);
    } finally {
      proto.setProperty = setProperty;
    }
    assert.ok(written.includes('-webkit-line-clamp: 2'), written.join('; '));
    assert.ok(written.includes('-webkit-line-clamp: 3'));
    assert.ok(written.includes('-webkit-box-orient: vertical'));
  });
  it('writes only the other gap longhand where the style sets one, in any key order', () => {
    const { container } = setup();
    render(() => (
      <div>
        <View style={{ columnGap: 4, gap: 10 }} />
        <View style={{ gap: 10, columnGap: 4 }} />
        <View style={{ columnGap: 4 }} gap={10} />
        <View gap={10} style={{ columnGap: 4 }} />
      </div>
    ), container);
    // A browser resets column-gap with a gap shorthand written after it (Chrome shows 10px there).
    for (const el of /** @type {any[]} */ ([...container.querySelectorAll('[data-ren="View"]')])) {
      const style = el.getAttribute('style');
      // A gap shorthand after the column-gap would reset it in a browser.
      const shorthand = style.search(/(^|;\s*)gap:/);
      assert.ok(shorthand < 0 || shorthand < style.indexOf('column-gap'), `no gap shorthand after column-gap: ${style}`);
      assert.equal(el.style.getPropertyValue('column-gap'), '4px');
      // happy-dom reads no longhand out of a shorthand: the row gap is row-gap's, else gap's.
      assert.equal(el.style.getPropertyValue('row-gap') || el.style.getPropertyValue('gap'), '10px');
    }
  });
  it('keeps layout="row"\'s wrap whatever the order of the props, the style\'s direction taking only the direction', () => {
    const { container } = setup();
    render(() => (
      <div>
        <View layout="row" style={{ width: 100, direction: 'row' }} />
        <View style={{ width: 100, direction: 'row' }} layout="row" />
        <View layout="row" style={{ direction: 'column', wrap: false }} />
      </div>
    ), container);
    const [first, second, third] = [...container.querySelectorAll('[data-ren="View"]')].map(declared);
    assert.deepEqual([first['flex-direction'], first['flex-wrap']], ['row', 'wrap'], 'the style after the shorthand');
    assert.deepEqual([second['flex-direction'], second['flex-wrap']], ['row', 'wrap'], 'the style before it: the same, as the canvases');
    assert.deepEqual([third['flex-direction'], third['flex-wrap']], ['column', 'nowrap'], "the style's own direction and wrap win");
  });
  it('writes a state as the base under it plus the state, as the canvases overlay it', () => {
    const { window, container } = setup();
    render(() => (
      <div>
        <View style={{ underline: true, hover: { strike: true } }} />
        <View style={{ border: 1, borderStyle: 'dashed', hover: { border: 2 } }} />
        <View style={{ border: 1, hover: { borderStyle: 'dotted' } }} />
        <View style={{ skewY: 5, hover: { skewX: 10 } }} />
      </div>
    ), container);
    const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]')).textContent;
    const rule = (/** @type {number} */ k) => {
      const el = /** @type {any} */ ([...container.querySelectorAll('[data-ren="View"]')][k]);
      const name = el.getAttribute('data-ren-state');
      return sheet.slice(sheet.indexOf(`.${name}:hover`)).split('}')[0];
    };
    assert.match(rule(0), /text-decoration: underline line-through !important/, 'the underline stays under the strike');
    assert.match(rule(1), /border-width: 2px !important/);
    assert.doesNotMatch(rule(1), /border-style/, 'the dashed border stays dashed');
    assert.match(rule(2), /border-style: dotted !important/, 'a state setting only the border style has a rule');
    assert.match(rule(3), /transform: skew\(10deg, 5deg\) !important/, "the base's skew stays with the state's");
  });
  it('composes states as the canvases do: each state\'s keys in its own order over the rest, and a rule for each combination', () => {
    const { window, container } = setup();
    const looks = [
      { right: 1, borderLeft: 1, hover: { inset: 4, right: 2 } },
      { background: '#111111', hover: { background: '#222222' }, press: { background: '#111111' } },
      { translate: [0, 0], hover: { translate: [0, -1] }, press: { translate: [0, 0] } },
      { hover: { zIndex: 2, borderLeft: 4 }, focus: { borderStyle: 'dashed' } },
      { skewX: 11, hover: { width: 75, borderRight: 4 }, press: { skewX: -2, borderStyle: 'dotted' } },
    ];
    render(() => <div>{looks.map(look => <View style={look} />)}</div>, container);
    const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]')).textContent;
    /** The declarations of an element's rule for a selector (':hover', ':hover:active', …). @param {number} k @param {string} pseudo */
    const rule = (k, pseudo) => {
      const name = /** @type {any} */ ([...container.querySelectorAll('[data-ren="View"]')][k]).getAttribute('data-ren-state');
      const at = sheet.indexOf(`.${name}${pseudo} {`);
      return at < 0 ? null : sheet.slice(at, sheet.indexOf('}', at));
    };
    assert.match(rule(0, ':hover') ?? '', /right: 2px !important/, 'the state\'s right after its inset, as its own order says');
    assert.doesNotMatch(rule(0, ':hover') ?? '', /right: 4px/);
    assert.match(rule(1, ':hover:active') ?? '', /background: #111111 !important/, 'pressed while hovered: the press over the hover');
    assert.match(rule(2, ':hover:active') ?? '', /translate: 0px 0px !important/, 'the hover lift goes while pressed');
    assert.match(rule(3, ':hover:focus') ?? '', /border-left-style: dashed !important/, 'the hover\'s border in the focus\'s style');
    assert.match(rule(4, ':hover:active') ?? '', /border-right-style: dotted !important/);
    assert.match(rule(4, ':hover:active') ?? '', /width: 75px !important/, 'what the hover set stays under the press');
    // A shorthand and its longhand in the state's order: the hover's border-left-width after the base's border.
    render(() => <View style={{ borderLeft: 1, border: 2, hover: { borderLeft: 1 } }} />, container);
    const last = /** @type {any} */ ([...container.querySelectorAll('[data-ren="View"]')].at(-1)).getAttribute('data-ren-state');
    const text = window.document.querySelector('style[data-ren-states]')?.textContent ?? '';
    const hovered = text.slice(text.indexOf(`.${last}:hover {`)).split('}')[0];
    // Read as a browser reads the rule: the left border 1px, the others 2px.
    const probe = /** @type {any} */ (window.document.createElement('p')).style;
    probe.cssText = hovered.slice(hovered.indexOf('{') + 1);
    assert.deepEqual([probe.getPropertyValue('border-left-width'), probe.getPropertyValue('border-top-width')], ['1px', '2px'], hovered);
  });
  it('writes a state rule\'s declarations through the CSSOM: a value or name that would end the rule is dropped', () => {
    const { window, container } = setup();
    const evil = 'red } body { background: url(https://attacker.example/x) } .z {';
    render(() => (
      <div>
        <View style={{ color: evil }} />
        <View style={{ color: 'blue', hover: { color: evil, background: '#222' }, press: { 'x} body {background: red': 1 } }} />
      </div>
    ), container);
    const inline = /** @type {any} */ (container.querySelector('[data-ren="View"]')).getAttribute('style');
    assert.doesNotMatch(inline, /attacker/, 'inline, the browser drops it');
    const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]')).textContent;
    assert.doesNotMatch(sheet, /attacker|body/, sheet);
    const name = /** @type {any} */ ([...container.querySelectorAll('[data-ren="View"]')][1]).getAttribute('data-ren-state');
    // Every rule in the sheet is this element's own.
    for (const rule of sheet.split('\n').filter(Boolean)) assert.ok(rule.startsWith(`.${name}:`), rule);
    assert.match(sheet, /background: #222 !important/, 'the valid declarations stay');
  });
});
