// Text actions on the DOM (ren-core's EDIT and TEXT): an Edit's field
// actions on its ref, a document's and a shadow root's static text actions
// (the Label under a pointer, its selection opened and released, the text
// selected now), and a right press that keeps a field's selection where an
// application's own menu is in charge.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { View, Label, Edit, Action, Root, $dispose, editOf, textAt, selectText, selectedText } from 'ren-core';
import { EDIT, TEXT } from 'ren-core/host';
import { render, $dom, $shadow } from 'ren-dom';

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

/** A pointer event of `type` at `target`, at a point; true when something cancelled it. @param {any} target @param {string} type @param {Record<string, any>} [init] */
const point = (target, type, init = {}) => {
  const e = new target.ownerDocument.defaultView.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, ...init });
  target.dispatchEvent(e);
  return e;
};
/** A mouse press of `button` at `target`; true when something cancelled it. @param {any} target @param {number} button */
const mousedown = (target, button) => {
  const e = new target.ownerDocument.defaultView.MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

/** Renders two Edits (a one-line and a multi-line) with their refs and the values onChange heard. @param {Record<string, any>} [props] */
const edits = (props = {}) => {
  const t = setup();
  /** @type {any} */
  let one = null;
  /** @type {any} */
  let many = null;
  /** @type {string[]} */
  const changes = [];
  const dispose = render(() => (
    <View>
      <Edit ref={(/** @type {any} */ e) => (one = e)} value="hello" onChange={e => changes.push(e.value)} {...props} />
      <Edit ref={(/** @type {any} */ e) => (many = e)} lines={3} value="ab" onChange={e => changes.push(e.value)} />
    </View>
  ), t.container);
  return { ...t, one, many, changes, dispose };
};

describe('ren dom text actions', () => {
  it("puts an Edit's field actions on its ref, an input's and a textarea's", () => {
    const { one, many } = edits();
    for (const field of [one, many]) {
      assert.equal(field[EDIT] != null, true);
      assert.equal(editOf(field), field[EDIT], "ren-core's editOf finds them");
    }
    const actions = /** @type {any} */ (editOf(one));
    assert.equal(actions.value(), 'hello');
    actions.setSelection(1, 3, 'backward');
    assert.deepEqual(actions.selection(), { start: 1, end: 3, direction: 'backward' });
    actions.selectAll();
    assert.deepEqual([one.selectionStart, one.selectionEnd], [0, 5]);
    assert.equal(actions.canUndo() && actions.canRedo(), true, 'the DOM tells nothing of the history: true');
  });

  it("replaces an unfocused field's selection with setRangeText and an input event onChange hears", () => {
    const { one, changes } = edits();
    const actions = /** @type {any} */ (editOf(one));
    actions.setSelection(1, 3);
    actions.replace('XY');
    assert.equal(one.value, 'hXYlo');
    assert.deepEqual(changes, ['hXYlo']);
    actions.setSelection(0, 1);
    actions.replace('');
    assert.equal(one.value, 'XYlo', 'an empty text cuts the selection');
    actions.setSelection(2, 2);
    actions.replace('');
    assert.deepEqual(changes, ['hXYlo', 'XYlo'], 'nothing to cut: no change');
  });

  it("replaces a focused field's selection through the browser's insertText (its undo keeps it), else setRangeText", () => {
    const { document, one, changes } = edits();
    /** @type {any[]} */
    const calls = [];
    let accept = true;
    // happy-dom has no execCommand: a browser's, which edits the focused field and fires its input.
    /** @type {any} */ (document).execCommand = (/** @type {string} */ command, /** @type {boolean} */ ui, /** @type {string} */ text) => {
      calls.push([command, text]);
      if (!accept) return false;
      const field = document.activeElement;
      field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
      field.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
      return true;
    };
    one.focus();
    const actions = /** @type {any} */ (editOf(one));
    actions.setSelection(0, 5);
    actions.replace('bye');
    assert.deepEqual(calls, [['insertText', 'bye']]);
    assert.equal(one.value, 'bye');
    assert.deepEqual(changes, ['bye'], 'one change: the browser\'s input');
    actions.setSelection(0, 3);
    actions.replace('');
    assert.deepEqual(calls[1], ['delete', ''], 'a cut is the browser\'s delete');
    accept = false;
    actions.replace('again');
    assert.equal(one.value, 'again', 'refused: setRangeText');
    assert.deepEqual(changes, ['bye', '', 'again']);
  });

  it('drops line breaks in a one-line field, keeps them in a multi-line one, and changes no read-only field', () => {
    const { one, many, changes } = edits();
    const line = /** @type {any} */ (editOf(one));
    line.setSelection(5, 5);
    line.replace(' a\r\nb\nc');
    assert.equal(one.value, 'hello abc');
    const lines = /** @type {any} */ (editOf(many));
    lines.setSelection(2, 2);
    lines.replace('\ncd');
    assert.equal(many.value, 'ab\ncd');
    assert.deepEqual(changes, ['hello abc', 'ab\ncd']);
    const fixed = edits({ readOnly: true });
    const actions = /** @type {any} */ (editOf(fixed.one));
    actions.selectAll();
    actions.replace('no');
    assert.equal(fixed.one.value, 'hello');
    assert.deepEqual(fixed.changes, []);
  });

  it("steps the browser's undo and redo in the focused field, and tells a secret, read-only or disabled field", () => {
    const { document, one } = edits();
    const actions = /** @type {any} */ (editOf(one));
    assert.equal(actions.undo(), false, 'no execCommand: no step');
    /** @type {string[]} */
    const calls = [];
    /** @type {any} */ (document).execCommand = (/** @type {string} */ command) => {
      calls.push(`${command}:${document.activeElement === one}`);
      return command === 'undo';
    };
    one.blur();
    assert.equal(actions.undo(), true);
    assert.equal(actions.redo(), false);
    assert.deepEqual(calls, ['undo:true', 'redo:true'], 'focused first');
    assert.deepEqual([actions.secret(), actions.readOnly(), actions.disabled()], [false, false, false]);
    const shut = edits({ secret: true, readOnly: true, disabled: true });
    const other = /** @type {any} */ (editOf(shut.one));
    assert.deepEqual([other.secret(), other.readOnly(), other.disabled()], [true, true, true]);
  });

  it("puts a document's text actions on it while a view is there, a Label's under a pointer, none over a field or a press", () => {
    const { document, container } = setup();
    const dispose = render(() => (
      <View>
        <Label text="first words" />
        <Label text="second" />
        <Edit label="q" value="typed" />
        <Action text="go" />
        <button>own</button>
      </View>
    ), container);
    assert.equal(/** @type {any} */ (document)[TEXT] != null, true);
    const [first, second] = container.querySelectorAll('[data-ren="Label"]');
    // happy-dom places no caret: the event's target's Label.
    assert.deepEqual(textAt(point(first, 'pointerdown')), { node: first, text: 'first words' });
    assert.equal(textAt(point(container.querySelector('input'), 'pointerdown')), null, 'a field');
    assert.equal(textAt(point(container.querySelector('[data-ren="Action"]'), 'pointerdown')), null, 'an Action');
    assert.equal(textAt(point(container.querySelector('button:not([data-ren])'), 'pointerdown')), null, 'a button');
    assert.equal(textAt(point(container.firstChild, 'pointerdown')), null, 'no text');
    // The browser's caret under the point: its text node's Label, while its boxes hold the point.
    /** @type {any} */ (document).caretPositionFromPoint = () => ({ offsetNode: second.firstChild, offset: 1 });
    assert.deepEqual(textAt(point(container.firstChild, 'pointerdown')), { node: second, text: 'second' });
    const Range = /** @type {any} */ (document.defaultView).Range;
    const rects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = () => [{ left: 0, right: 5, top: 0, bottom: 5 }];
    try {
      assert.equal(textAt(point(container.firstChild, 'pointerdown')), null, 'the caret beside the text: none');
      assert.deepEqual(textAt(point(container.firstChild, 'pointerdown', { clientX: 2, clientY: 2 })), { node: second, text: 'second' });
    } finally {
      Range.prototype.getClientRects = rects;
    }
    delete (/** @type {any} */ (document)).caretPositionFromPoint;
    /** @type {any} */ (document).caretRangeFromPoint = () => ({ startContainer: first.firstChild });
    assert.deepEqual(textAt(point(container.firstChild, 'pointerdown')), { node: first, text: 'first words' }, "the older caretRangeFromPoint");
    dispose();
    assert.equal(/** @type {any} */ (document)[TEXT], undefined, 'gone with the last view');
  });

  it('opens selection on a text and selects all of it, until a press outside it, Escape or its release', () => {
    const { document, container } = setup();
    const root = Root({
      id: 'texts',
      target: container,
      renderer: $dom(document),
      children: () => (
        <View>
          <Label text="pick me" style={{ cursor: 'pointer' }} />
          <Label text="other" />
        </View>
      ),
    });
    const [label, other] = container.querySelectorAll('[data-ren="Label"]');
    const before = [label.style.getPropertyValue('user-select'), label.style.getPropertyValue('cursor')];
    const release = /** @type {() => void} */ (selectText(label));
    assert.deepEqual([label.style.getPropertyValue('user-select'), label.style.getPropertyValue('cursor')], ['text', 'text']);
    assert.equal(String(document.getSelection()), 'pick me', 'all of it selected');
    assert.equal(selectedText(label), 'pick me');
    point(label, 'pointerdown', { button: 2 });
    assert.equal(String(document.getSelection()), 'pick me', 'a right press inside keeps the selection, for a menu');
    point(label, 'pointerdown');
    assert.equal(label.style.getPropertyValue('user-select'), 'text', 'a press inside keeps it open');
    assert.equal(String(document.getSelection()), '', 'a primary press inside starts a new selection where it lands (no drag of the whole)');
    point(other, 'pointerdown');
    assert.deepEqual([label.style.getPropertyValue('user-select'), label.style.getPropertyValue('cursor')], before, 'a press outside releases it');
    release();
    assert.deepEqual([label.style.getPropertyValue('user-select'), label.style.getPropertyValue('cursor')], before, 'its release again does nothing');
    selectText(label);
    document.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepEqual([label.style.getPropertyValue('user-select'), label.style.getPropertyValue('cursor')], before, 'Escape releases it');
    assert.equal(String(document.getSelection()), '', 'and clears its selection');
    selectText(label);
    selectText(other);
    assert.deepEqual([label.style.getPropertyValue('user-select'), label.style.getPropertyValue('cursor')], before, 'one open at a time');
    assert.equal(other.style.getPropertyValue('user-select'), 'text');
    $dispose(root);
    assert.equal(other.style.getPropertyValue('user-select'), '', 'released with the last view');
  });

  it("tells the text selected now: a focused field's (none of a secret one), else the page's", () => {
    const { document, container } = setup();
    render(() => (
      <View>
        <Label text="page text" />
        <Edit label="q" value="field text" />
        <Edit label="p" value="hidden" secret />
      </View>
    ), container);
    const [field, secret] = container.querySelectorAll('input');
    const label = container.querySelector('[data-ren="Label"]');
    const range = document.createRange();
    range.selectNodeContents(label);
    document.getSelection().addRange(range);
    assert.equal(selectedText(label), 'page text');
    field.focus();
    field.setSelectionRange(0, 5);
    assert.equal(selectedText(label), 'field');
    secret.focus();
    secret.select();
    assert.equal(selectedText(label), '', "a secret field's: none");
  });

  it('puts the text actions on the shadow root it renders into', () => {
    const { document, container } = setup();
    /** @type {any} */
    let label = null;
    const root = Root({
      id: 'shaded',
      target: container,
      renderer: $shadow({ mode: 'open' }),
      children: () => <View><Label ref={(/** @type {any} */ el) => (label = el)} text="inside" /></View>,
    });
    const shadow = label.getRootNode();
    assert.equal(shadow[TEXT] != null && shadow[TEXT] !== /** @type {any} */ (document)[TEXT], true);
    assert.deepEqual(textAt(point(label, 'pointerdown')), { node: label, text: 'inside' });
    $dispose(root);
    assert.equal(shadow[TEXT], undefined);
  });

  it("cancels a right press in an Edit where the application's own menu is in charge, so the field keeps its selection", () => {
    const { container } = setup();
    render(() => (
      <View>
        <View prevent="contextmenu">
          <Edit label="menu" value="mine" />
          <Label text="loose" />
        </View>
        <Edit label="plain" value="browser's" />
      </View>
    ), container);
    const [mine, plain] = container.querySelectorAll('input');
    assert.equal(mousedown(mine, 2), true, 'a right press under prevent="contextmenu"');
    assert.equal(mousedown(mine, 0), false, 'a left press moves the caret');
    assert.equal(mousedown(plain, 2), false, "the browser's menu: its own press");
    assert.equal(mousedown(container.querySelector('[data-ren="Label"]'), 2), false, 'not a field');
  });
});
