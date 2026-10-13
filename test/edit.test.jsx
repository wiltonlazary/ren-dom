// The portable Edit and Label on the DOM: a controlled value, disabled and
// readOnly, a secret, the placeholder's color, autosize, and a Label's line
// clamp and ellipsis.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write } from 'rrx-core';
import { View, Label, Edit, Action, Root, $active } from 'ren-core';
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

describe('ren dom Edit and Label', () => {
  it("gives an Edit's caret row and row count (caretRow), its own lines where nothing is laid out", () => {
    const { container } = setup();
    /** @type {any} */
    let many = null;
    /** @type {any} */
    let one = null;
    render(() => (
      <View>
        <Edit ref={(/** @type {any} */ e) => (many = e)} lines={3} value={'ab\ncd\n'} />
        <Edit ref={(/** @type {any} */ e) => (one = e)} value="one line" />
      </View>
    ), container);
    many.setSelectionRange(4, 4);
    assert.deepEqual(many.caretRow(), { row: 1, rows: 3 });
    many.setSelectionRange(6, 6);
    assert.deepEqual(many.caretRow(), { row: 2, rows: 3 }, 'after the last line break: the new last row');
    many.setSelectionRange(1, 4, 'backward');
    assert.deepEqual(many.caretRow(), { row: 0, rows: 3 }, 'a backward selection: its start is the caret');
    assert.deepEqual(one.caretRow(), { row: 0, rows: 1 }, 'a one-line Edit: row 0 of 1');
  });

  it('shows a controlled Edit\'s bound value again after a keystroke the view rejected', () => {
    const { container } = setup();
    const root = $root('app');
    const v = $signal(root, 'ab');
    const u = $signal(root, '');
    render(() => (
      <View>
        <Edit value={v} onChange={e => { if (/^[a-z]*$/.test(e.value)) $write(v, e.value); }} />
        <Edit value={u} onChange={e => $write(u, e.value.toUpperCase())} />
      </View>
    ), container, { root });
    const [letters, upper] = container.querySelectorAll('input');
    type(letters, 'abc');
    assert.equal(letters.value, 'abc');
    type(letters, 'abcX');
    assert.equal($read(v), 'abc');
    assert.equal(letters.value, 'abc', 'the rejected X is gone');
    type(upper, 'x');
    assert.equal(upper.value, 'X', 'a value the view rewrites shows as written');
  });

  it('maps disabled, readOnly and secret to the input, and dims a disabled Edit by the theme', () => {
    const { document, container } = setup();
    /** @type {any} */
    let locked;
    /** @type {any} */
    let hide;
    const Form = () => {
      locked = $signal($active(), true);
      hide = $signal($active(), true);
      return (
        <View>
          <Edit disabled />
          <Edit readOnly={locked} value="kept" />
          <Edit secret={hide} value="hunter2" />
          <Edit lines={3} secret />
        </View>
      );
    };
    Root({
      id: 'form',
      target: container,
      renderer: $dom(document),
      children: <Form />,
    });
    const [disabled, readOnly, secret] = container.querySelectorAll('input');
    assert.equal(disabled.disabled, true);
    assert.equal(readOnly.readOnly, true);
    assert.equal(secret.type, 'password');
    assert.equal(secret.value, 'hunter2', 'the value stays real');
    $write(locked, false);
    $write(hide, false);
    assert.equal(readOnly.readOnly, false);
    assert.equal(secret.type, 'text');
    assert.equal(container.querySelector('textarea').getAttribute('type'), null, 'a multi-line Edit has no password form');
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    assert.match(sheet, /\[data-ren="Edit"\]:disabled[^{]*\{ background: var\(--ren-soft\); color: var\(--ren-muted\); \}/);
  });

  it('colors the placeholder by the portable style, inherited', () => {
    const { document, container } = setup();
    Root({
      id: 'hint',
      target: container,
      renderer: $dom(document),
      children: (
        <View style={{ placeholderColor: '#808080' }}>
          <Edit label="Name" />
          <Edit label="Mail" style={{ placeholderColor: 0xffff0000 }} />
        </View>
      ),
    });
    const [view] = container.querySelectorAll('[data-ren=View]');
    const [, mail] = container.querySelectorAll('input');
    assert.equal(view.style.getPropertyValue('--ren-placeholder'), '#808080');
    assert.equal(mail.style.getPropertyValue('--ren-placeholder'), 'rgba(255, 0, 0, 1)');
    const sheet = container.querySelector('style[data-ren-style]').textContent;
    assert.match(sheet, /::placeholder \{ color: var\(--ren-placeholder, var\(--ren-muted\)\); \}/);
  });

  it('grows a multi-line Edit with its content between its lines and autosize', () => {
    const { container } = setup();
    const root = $root('grow');
    const grow = $signal(root, /** @type {boolean | number} */ (6));
    render(() => <Edit lines={2} autosize={grow} />, container, { root });
    const area = container.querySelector('textarea');
    assert.equal(area.style.getPropertyValue('field-sizing'), 'content');
    // Its width is its box's, not its text's, as on the canvases (Chrome: 680
    // px wide for a long value in a row, where the canvases keep the entry's 200).
    assert.equal(area.style.getPropertyValue('contain'), 'inline-size', 'it grows down only');
    assert.equal(area.getAttribute('cols'), '1', "its width is the theme's entry, not 20 columns");
    assert.equal(area.style.height, '');
    assert.equal(area.style.minHeight, 'calc(var(--ren-field, 38px) + 1 * 1lh)');
    assert.equal(area.style.maxHeight, 'calc(var(--ren-field, 38px) + 5 * 1lh)');
    $write(grow, true);
    assert.equal(area.style.maxHeight, '', 'no limit');
    $write(grow, false);
    assert.equal(area.style.getPropertyValue('field-sizing'), '');
    assert.equal(area.style.getPropertyValue('contain'), '');
    assert.equal(area.style.height, 'calc(var(--ren-field, 38px) + 1 * 1lh)', 'its lines again');
  });

  it('lets a style minHeight win over autosize\'s minimum, whichever prop comes first, as the canvases do', () => {
    const { container } = setup();
    const root = $root('minimum');
    const own = $signal(root, /** @type {number | undefined} */ (100));
    /** @type {any[]} */
    const areas = [];
    render(() => (
      <div>
        <Edit ref={(/** @type {any} */ e) => areas.push(e)} lines={2} autosize style={() => ({ minHeight: $read(own) })} />
        <Edit ref={(/** @type {any} */ e) => areas.push(e)} style={() => ({ minHeight: $read(own) })} lines={2} autosize />
      </div>
    ), container, { root });
    assert.deepEqual(areas.map(a => a.style.minHeight), ['100px', '100px'], 'the style\'s, autosize before it and after it');
    $write(own, undefined);
    const rows = 'calc(var(--ren-field, 38px) + 1 * 1lh)';
    assert.deepEqual(areas.map(a => a.style.minHeight), [rows, rows], 'unset, the rows\' minimum again');
    $write(own, 120);
    assert.deepEqual(areas.map(a => a.style.minHeight), ['120px', '120px']);
  });

  it('lets a style\'s minHeight, maxHeight and height win over autosize\'s in every order and state, as the canvases do', () => {
    // The canvases (lines 2, a value of 7 lines) give maxHeight 80 -> 80 and height 90 -> 90 with autosize 6,
    // 61.8 (its rows) and 90 without: the style's value holds in every order, and what it leaves is autosize's.
    const { document, container } = setup();
    const root = $root('heights');
    const grow = $signal(root, /** @type {boolean | number} */ (6));
    const own = $signal(root, /** @type {Record<string, number> | undefined} */ (undefined));
    const V = 'a\nb\nc\nd\ne\nf\ng';
    /** @type {any[]} */
    const areas = [];
    const ref = (/** @type {any} */ e) => areas.push(e);
    render(() => (
      <div>
        <Edit ref={ref} lines={2} value={V} autosize={grow} />
        <Edit ref={ref} style={() => $read(own)} lines={2} autosize={grow} value={V} />
        <Edit ref={ref} lines={2} value={V} autosize={grow} style={() => $read(own)} />
      </div>
    ), container, { root });
    const keys = /** @type {const} */ (['minHeight', 'maxHeight', 'height']);
    const check = (/** @type {string} */ at) => {
      const style = $read(own) ?? {};
      for (const key of keys) {
        const want = key in style ? `${style[key]}px` : areas[0].style[key];
        assert.deepEqual([areas[1].style[key], areas[2].style[key]], [want, want], `${at}: ${key}`);
      }
    };
    const plain = areas[0].style;
    const rows = (/** @type {number} */ n) => `calc(var(--ren-field, 38px) + ${n - 1} * 1lh)`;
    const styles = [{ maxHeight: 80 }, { height: 90 }, { minHeight: 100 }, { minHeight: 30, maxHeight: 80, height: 90 }];
    // Given at mount, before autosize and after it.
    for (const style of styles)
      for (const size of [6, false, true]) {
        const at = document.createElement('div');
        /** @type {any[]} */
        const mounted = [];
        const put = (/** @type {any} */ e) => mounted.push(e);
        render(() => (
          <div>
            <Edit ref={put} lines={2} value={V} autosize={size} />
            <Edit ref={put} style={style} lines={2} autosize={size} value={V} />
            <Edit ref={put} lines={2} value={V} autosize={size} style={style} />
          </div>
        ), at, { root });
        for (const key of keys) {
          const want = key in style ? `${/** @type {any} */ (style)[key]}px` : mounted[0].style[key];
          assert.deepEqual([mounted[1].style[key], mounted[2].style[key]], [want, want], `${JSON.stringify(style)} at mount, autosize ${size}: ${key}`);
        }
      }
    for (const style of styles) {
      for (const size of [6, false, true, 6]) {
        $write(grow, size);
        // The plain Edit shows autosize's own values.
        if (size === false) assert.deepEqual([plain.maxHeight, plain.height], ['', rows(2)]);
        else assert.deepEqual([plain.minHeight, plain.maxHeight, plain.height], [rows(2), size === true ? '' : rows(6), '']);
        $write(own, style);
        check(`${JSON.stringify(style)} set, autosize ${size}`);
        $write(grow, size === false ? 6 : false);
        check(`${JSON.stringify(style)}, autosize toggled from ${size}`);
        $write(grow, size);
        check(`${JSON.stringify(style)}, autosize ${size} again`);
        $write(own, undefined);
        check(`${JSON.stringify(style)} dropped, autosize ${size}`);
      }
    }
  });

  it('clamps a Label to its lines and ends one line with an ellipsis', () => {
    const { container } = setup();
    const root = $root('clamp');
    const lines = $signal(root, 2);
    const cut = $signal(root, true);
    render(() => (
      <View>
        <Label text="a long text" lines={lines} />
        <Label text="one line" ellipsis={cut} />
      </View>
    ), container, { root });
    const [clamped, one] = container.querySelectorAll('[data-ren=Label]');
    assert.equal(clamped.style.getPropertyValue('line-clamp'), '2');
    assert.equal(clamped.style.overflow, 'hidden');
    assert.equal(clamped.style.whiteSpace, 'pre-wrap', 'wrapped');
    assert.equal(one.style.overflow, 'hidden');
    assert.equal(one.style.textOverflow, 'ellipsis');
    assert.equal(one.style.whiteSpace, 'pre', 'one line');
    $write(lines, 0);
    $write(cut, false);
    assert.equal(clamped.style.getPropertyValue('line-clamp'), '');
    assert.equal(clamped.style.whiteSpace, 'pre');
    assert.equal(clamped.style.overflow, '');
    assert.equal(clamped.style.display, 'block', 'its base display again');
    assert.equal(one.style.textOverflow, '');
  });

  it('keeps an explicit aria-label over the name its label (the placeholder) gives', () => {
    const { container } = setup();
    const root = $root('app');
    const hint = $signal(root, 'you@example.com');
    const name = $signal(root, 'Email');
    const caption = $signal(root, 'Send');
    render(() => (
      <View>
        <Edit label={hint} aria-label={name} />
        <Edit label={hint} />
        <Action label={caption} aria-label="Send the mail" />
      </View>
    ), container, { root });
    const [named, plain] = container.querySelectorAll('input');
    const button = container.querySelector('button');
    assert.equal(named.getAttribute('aria-label'), 'Email');
    assert.equal(button.getAttribute('aria-label'), 'Send the mail');
    $write(hint, 'name@example.com');
    $write(caption, 'Mail');
    // The placeholder changes; the name the application gave stays.
    assert.equal(named.placeholder, 'name@example.com');
    assert.equal(named.getAttribute('aria-label'), 'Email');
    assert.equal(button.getAttribute('aria-label'), 'Send the mail');
    // Without one, the label still names the field.
    assert.equal(plain.getAttribute('aria-label'), 'name@example.com');
    // Its own name gone, the label names it again.
    $write(name, null);
    assert.equal(named.getAttribute('aria-label'), 'name@example.com');
    $write(hint, 'x@example.com');
    assert.equal(named.getAttribute('aria-label'), 'x@example.com');
    $write(name, 'Mail');
    assert.equal(named.getAttribute('aria-label'), 'Mail');
  });
});
