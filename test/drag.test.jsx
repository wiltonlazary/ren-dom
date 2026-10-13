// Drags on the DOM as on the canvases: the canvases never drag an image or
// a text natively, so a portable primitive does not start one either (a
// swipe on a Carousel's Image keeps its pointer), while HTML the
// application writes keeps the browser's own drags; and a pointer the
// browser takes back reaches the handlers as the DOM's own pointercancel,
// with no release after it.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { View, Label, Image } from 'ren-core';
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
  const window = new Window();
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { window, document, container };
};

/** Starts a native drag at `node` (an image, or a selection's text); true when the renderer cancelled it. @param {any} node */
const drag = node => {
  const e = new node.ownerDocument.defaultView.Event('dragstart', { bubbles: true, cancelable: true, composed: true });
  node.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('ren dom native drags', () => {
  it('makes a portable Image not draggable, and leaves an application\'s img alone', () => {
    const { container } = setup();
    const dispose = render(() => (
      <View>
        <Image source="a.png" />
        <img src="b.png" />
        <Image source="c.png" draggable="true" />
      </View>
    ), container);
    const [image, img, own] = container.querySelectorAll('img');
    assert.equal(image.getAttribute('draggable'), 'false');
    assert.equal(img.hasAttribute('draggable'), false);
    // A draggable the application asks for wins.
    assert.equal(own.getAttribute('draggable'), 'true');
    dispose();
  });

  it('cancels a native drag that starts in a primitive (a selected text), not in the application\'s HTML', () => {
    const { container } = setup();
    const started = [];
    const dispose = render(() => (
      <View>
        <Label text="selected words" />
        <Image source="a.png" />
        <a href="#b">a link</a>
        <img src="b.png" />
        <View draggable="true">
          <Label text="a draggable box's text" />
        </View>
        <View onDragStart={() => started.push('own')}>
          <Label text="a box that hears its drags" />
        </View>
      </View>
    ), container);
    const labels = container.querySelectorAll('[data-ren=Label]');
    assert.equal(drag(labels[0].firstChild), true, 'a selection dragged from a Label');
    assert.equal(drag(container.querySelector('[data-ren=Image]')), true, 'a portable Image');
    assert.equal(drag(container.querySelector('a').firstChild), false, 'the application\'s link');
    assert.equal(drag(container.querySelector('img:not([data-ren])')), false, 'the application\'s img');
    assert.equal(drag(labels[1].firstChild), false, 'inside a primitive the application made draggable');
    assert.equal(drag(labels[2].firstChild), false, 'inside a primitive that hears its drags');
    assert.deepEqual(started, ['own']);
    dispose();
    // Gone with the view: its container cancels nothing after.
    container.appendChild(labels[0]);
    assert.equal(drag(labels[0].firstChild), false);
  });

  it('delivers the browser taking a press back as onPointerCancel, bubbling, and no pointerup', () => {
    const { window, container } = setup();
    /** @type {string[]} */
    const heard = [];
    const note = (/** @type {string} */ at) => (/** @type {any} */ e) => heard.push(`${at} ${e.type} ${e.pointerId}`);
    const dispose = render(() => (
      <View onPointerDown={note('view')} onPointerUp={note('view')} onPointerCancel={note('view')}>
        <Image source="a.png" onPointerCancel={note('image')} />
      </View>
    ), container);
    const image = container.querySelector('img');
    const send = (/** @type {string} */ type) => image.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 5, pointerId: 3 }));
    send('pointerdown');
    send('pointercancel');
    assert.deepEqual(heard, ['view pointerdown 3', 'image pointercancel 3', 'view pointercancel 3']);
    dispose();
  });
});
