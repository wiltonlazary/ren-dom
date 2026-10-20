// A root behaves as an application by default and as a page on request
// (the `behavior` option, ren-core's behaviorOf): loose text neither
// selectable nor showing the I-beam, no page-wide select-all, no browser
// menu but in a field, no touch callout; each switch on its own.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { View, Label, Edit, Root, $dispose } from 'ren-core';
import { $dom, $shadow } from 'ren-dom';

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
  const page = document.createElement('div');
  document.body.appendChild(page);
  return { window, document, page };
};
/** The inline declarations of an element, read by property name ('' reads as undefined). @param {any} el */
const declared = el => /** @type {Record<string, string | undefined>} */ (new Proxy({}, { get: (_, name) => el.style.getPropertyValue(String(name)) || undefined }));

/** The host styles a behavior writes, every one (happy-dom drops the prefixed ones). */
const HOST = ['user-select', '-webkit-user-select', 'cursor', '-webkit-touch-callout', '-webkit-tap-highlight-color'];
/**
 * What a renderer writes on its host element with `styles: false`, on a
 * host whose style keeps every declaration (happy-dom drops the prefixed
 * ones), after open and after close.
 * @param {any} document @param {any} behavior
 */
const hostOf = (document, behavior) => {
  /** @type {Map<string, string>} */
  const map = new Map();
  const style = {
    setProperty: (/** @type {string} */ name, /** @type {string} */ value) => void map.set(name, value),
    removeProperty: (/** @type {string} */ name) => void map.delete(name),
    getPropertyValue: (/** @type {string} */ name) => map.get(name) ?? '',
  };
  const host = { ownerDocument: document, style, setAttribute() {}, removeAttribute() {} };
  const H = $dom(document, { styles: false, behavior });
  /** @type {any} */ (H).open(host, 'probe');
  /** @type {Record<string, string>} */
  const open = {};
  for (const name of HOST) if (map.has(name)) open[name] = /** @type {string} */ (map.get(name));
  /** @type {any} */ (H).close();
  return { open, closed: HOST.filter(name => map.has(name)) };
};

/** A cancelable event of `type` dispatched at `target`; true when something cancelled it. @param {any} target @param {string} type */
const fire = (target, type) => {
  const e = new target.ownerDocument.defaultView.MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};
/** Ctrl (or Cmd) and a key down at `target`; true when something cancelled it. @param {any} target @param {string} key */
const press = (target, key, meta = false) => {
  const e = new target.ownerDocument.defaultView.KeyboardEvent('keydown', { key, ctrlKey: !meta, metaKey: meta, bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('ren dom behavior', () => {
  it('writes an app on its host element with styles: false too, nothing for a page, and takes it off on close', () => {
    const { document } = setup();
    const app = hostOf(document, undefined);
    assert.deepEqual(app.open, {
      'user-select': 'none',
      '-webkit-user-select': 'none',
      cursor: 'default',
      '-webkit-touch-callout': 'none',
      '-webkit-tap-highlight-color': 'transparent',
    });
    assert.deepEqual(app.closed, [], 'close takes them off');
    assert.deepEqual(hostOf(document, 'app').open, app.open, "'app' is the default");
    assert.deepEqual(hostOf(document, 'page').open, {}, 'a page writes nothing');
  });

  it('lets each switch over an app give its own part back, and each over a page take its part', () => {
    const { document } = setup();
    assert.deepEqual(Object.keys(hostOf(document, { like: 'app', select: true }).open), ['cursor', '-webkit-touch-callout', '-webkit-tap-highlight-color']);
    assert.deepEqual(Object.keys(hostOf(document, { like: 'app', textCursor: true }).open), ['user-select', '-webkit-user-select', '-webkit-touch-callout', '-webkit-tap-highlight-color']);
    assert.deepEqual(Object.keys(hostOf(document, { like: 'app', callout: true }).open), ['user-select', '-webkit-user-select', 'cursor']);
    assert.deepEqual(hostOf(document, { like: 'page', textCursor: false }).open, { cursor: 'default' });
  });

  it("sets an application root's host element in the document, and the page's own", () => {
    const { document, page } = setup();
    const root = Root({ id: 'app', target: page, renderer: $dom(document), children: <Label text="loose" /> });
    const host = page.querySelector('[data-ren-root="app"]');
    assert.equal(declared(host)['user-select'], 'none');
    assert.equal(declared(host).cursor, 'default');
    $dispose(root);
    const paged = Root({ id: 'page', target: page, renderer: $dom(document, { behavior: 'page' }), children: <Label text="loose" /> });
    const other = page.querySelector('[data-ren-root="page"]');
    assert.equal(declared(other)['user-select'], undefined);
    assert.equal(declared(other).cursor, undefined);
    $dispose(paged);
  });

  it('keeps an Edit selectable with the I-beam under an app, without the sheet too; its own cursor wins', () => {
    const { document, page } = setup();
    for (const styles of [true, false]) {
      const root = Root({
        id: 'form',
        target: page,
        renderer: $dom(document, { styles }),
        children: (
          <View>
            <Edit label="q" value="" />
            <Edit label="r" value="" style={{ cursor: 'pointer' }} />
            <Edit label="s" value="" lines={3} />
          </View>
        ),
      });
      const [plain, pointed, area] = page.querySelectorAll('[data-ren="Edit"]');
      assert.equal(declared(plain)['user-select'], 'text', `styles ${styles}`);
      assert.equal(declared(plain).cursor, 'text');
      assert.equal(declared(area)['user-select'], 'text', 'a multi-line Edit');
      assert.equal(declared(pointed).cursor, 'pointer', "the style's cursor");
      $dispose(root);
    }
  });

  it("gives the text fields the application writes an Edit's selection and I-beam in the sheet, as the switches leave them", () => {
    const { document, page } = setup();
    /** @param {any} behavior */
    const sheetOf = behavior => {
      const root = Root({ id: 'own', target: page, renderer: $dom(document, { behavior }), children: <View /> });
      const text = page.querySelector('style[data-ren-style]').textContent;
      $dispose(root);
      return text.split('\n').find((/** @type {string} */ l) => l.includes('[contenteditable]')) ?? '';
    };
    const app = sheetOf(undefined);
    assert.match(app, /:is\(textarea, input:is\(:not\(\[type\]\), \[type="text" i\]/);
    assert.match(app, /\{ user-select: text; -webkit-user-select: text; cursor: text; \}/);
    assert.match(sheetOf({ like: 'app', select: true }), /\{ cursor: text; \}/);
    assert.match(sheetOf({ like: 'app', textCursor: true }), /\{ user-select: text; -webkit-user-select: text; \}/);
    assert.equal(sheetOf('page'), '', 'none for a page');
  });

  it("opts a style's text in with the I-beam over it, unless the style sets a cursor", () => {
    const { document, page } = setup();
    const root = Root({
      id: 'opt',
      target: page,
      renderer: $dom(document),
      children: (
        <View>
          <Label text="a" style={{ select: 'text' }} />
          <Label text="b" style={{ select: 'text', cursor: 'pointer' }} />
          <Label text="c" style={{ select: 'none' }} />
        </View>
      ),
    });
    const [a, b, c] = [...page.querySelectorAll('[data-ren="Label"]')].map(declared);
    assert.deepEqual([a['user-select'], a.cursor], ['text', 'auto']);
    assert.deepEqual([b['user-select'], b.cursor], ['text', 'pointer']);
    assert.deepEqual([c['user-select'], c.cursor], ['none', undefined]);
    $dispose(root);
  });

  it("cancels the browser's menu over an app's nodes but in a field, and the handlers still hear it", () => {
    const { document, page } = setup();
    /** @type {string[]} */
    const heard = [];
    /** @param {any} behavior @param {string} id */
    const make = (behavior, id) =>
      Root({
        id,
        target: page,
        renderer: $dom(document, { behavior }),
        children: (
          <View onContextMenu={() => heard.push(id)}>
            <Label text="loose" />
            <button>own</button>
            <Edit label="q" value="" />
            <div contentEditable="true">
              <b>rich</b>
            </div>
            <i prevent="contextmenu">kept off</i>
          </View>
        ),
      });
    /** @param {string} id */
    const menus = id => {
      const host = page.querySelector(`[data-ren-root="${id}"]`);
      return ['[data-ren="Label"]', 'button', 'input', 'b', 'i'].map(s => fire(host.querySelector(s).firstChild ?? host.querySelector(s), 'contextmenu'));
    };
    const app = make(undefined, 'app');
    assert.deepEqual(menus('app'), [true, true, false, false, true], 'a Label, a button: none; an Edit, a contenteditable: the browser\'s');
    assert.deepEqual(heard.splice(0), ['app', 'app', 'app', 'app', 'app']);
    $dispose(app);
    const strict = make({ editMenu: false }, 'strict');
    assert.deepEqual(menus('strict'), [true, true, true, true, true], 'editMenu false: none in a field either');
    $dispose(strict);
    const paged = make('page', 'page');
    assert.deepEqual(menus('page'), [false, false, false, false, true], "a page: the browser's, but where prevent says");
    $dispose(paged);
    const menu = make({ like: 'app', menu: true }, 'menu');
    assert.deepEqual(menus('menu'), [false, false, false, false, true], 'menu alone over an app');
    $dispose(menu);
    assert.equal(heard.length, 15);
  });

  it('leaves a nested root its own menu, and gives its host element back what the parent turned off', () => {
    const { document, page } = setup();
    const root = Root({
      id: 'outer',
      target: page,
      renderer: $dom(document),
      children: (
        <View>
          <Root id="paged" renderer={$dom(document, { behavior: 'page' })}>{() => <Label text="page text" />}</Root>
          <Root id="beam" renderer={$shadow({ document, behavior: { textCursor: true } })}>{() => <Label text="beam" />}</Root>
          <Root id="plain">{() => <Label text="app text" />}</Root>
        </View>
      ),
    });
    const [paged, beam, plain] = ['paged', 'beam', 'plain'].map(id => page.querySelector(`[data-ren-root="${id}"]`));
    assert.deepEqual([declared(paged)['user-select'], declared(paged).cursor], ['text', 'auto'], 'a page inside an app');
    assert.deepEqual([declared(beam)['user-select'], declared(beam).cursor], ['none', 'auto'], 'an app with the I-beam on');
    assert.deepEqual([declared(plain)['user-select'], declared(plain).cursor], ['none', 'default'], 'an app of its own');
    assert.equal(fire(paged.querySelector('[data-ren="Label"]'), 'contextmenu'), false, "the page's menu");
    assert.equal(fire(beam.shadowRoot.querySelector('[data-ren="Label"]'), 'contextmenu'), true);
    $dispose(root);
  });

  it('keeps Ctrl or Cmd+A to a field, or the text opted in, in an app', () => {
    const { document, page } = setup();
    const root = Root({
      id: 'keys',
      target: page,
      renderer: $dom(document),
      children: (
        <View>
          <Label text="loose" />
          <button>act</button>
          <Edit label="q" value="typed" />
          <View style={{ select: 'text' }}>
            <Label text="opted " />
            <button>in</button>
          </View>
        </View>
      ),
    });
    const host = page.querySelector('[data-ren-root="keys"]');
    const selection = document.getSelection();
    assert.equal(press(document.body, 'a'), true, 'nothing focused: nothing selected');
    assert.equal(press(document.body, 'a', true), true, 'Cmd too');
    assert.equal(press(host.querySelector('button'), 'a'), true, 'focused in the root');
    assert.equal(press(host.querySelector('input'), 'a'), false, 'a field selects its own');
    assert.equal(press(document.body, 'b'), false, 'another key');
    const opted = host.querySelectorAll('[data-ren="View"]')[1];
    const range = document.createRange();
    range.setStart(opted.firstChild.firstChild, 2);
    selection.removeAllRanges();
    selection.addRange(range);
    assert.equal(press(document.body, 'a'), true);
    assert.equal(selection.toString(), opted.textContent, 'the opted-in text around the selection, all of it');
    selection.removeAllRanges();
    assert.equal(press(opted.querySelector('button'), 'a'), true);
    assert.equal(selection.toString(), opted.textContent, 'around the focus');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    assert.equal(press(outside, 'a'), false, 'focused outside the root: not its');
    $dispose(root);
    assert.equal(press(document.body, 'a'), false, 'the guard goes with the root');
  });

  it('leaves Ctrl or Cmd+A to a page, to selectAll on, and to a selection in another root', () => {
    const { document, page } = setup();
    const paged = Root({ id: 'page', target: page, renderer: $dom(document, { behavior: 'page' }), children: <Label text="page text" /> });
    assert.equal(press(document.body, 'a'), false, 'a page');
    const all = Root({ id: 'all', target: page, renderer: $dom(document, { behavior: { like: 'app', selectAll: true } }), children: <button>x</button> });
    assert.equal(press(page.querySelector('[data-ren-root="all"] button'), 'a'), false, 'selectAll alone over an app');
    const app = Root({ id: 'app', target: page, renderer: $dom(document), children: <Label text="app text" /> });
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(page.querySelector('[data-ren-root="page"] [data-ren="Label"]').firstChild, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    assert.equal(press(document.body, 'a'), false, "the selection is the page's");
    range.setStart(page.querySelector('[data-ren-root="app"] [data-ren="Label"]').firstChild, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    assert.equal(press(document.body, 'a'), true, "the app's");
    $dispose(app);
    $dispose(all);
    $dispose(paged);
  });
});
