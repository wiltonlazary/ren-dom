// Event delegation: one listener per bubbling event type at the root's
// container (or shadow root, or a portal's target), handlers on the nodes,
// dispatch along the composed path; non-bubbling events stay direct; nested
// roots handle their own; nothing is left after dispose.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { $signal, $read, $write, $dispose, $catch } from 'rrx-core';
import { Root, For, Portal, Recover, Show, $keys, $scrolls, $active, View, Edit, Scroll, Action } from 'ren-core';
import { render, $dom, $shadow } from 'ren-dom';

/** Windows to close and prototypes to restore after each test. */
const cleanups = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()();
});

// Assertions compare counts and booleans only: a failing comparison of DOM
// nodes would make the runner inspect the whole happy-dom graph.
const setup = () => {
  const window = new Window();
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  // Every listener added or removed, by target and type, counted on the
  // prototype that defines addEventListener (window.EventTarget extends it).
  let EventTarget = container;
  while (!Object.getOwnPropertyDescriptor(EventTarget, 'addEventListener')) EventTarget = Object.getPrototypeOf(EventTarget);
  const add = EventTarget.addEventListener;
  const remove = EventTarget.removeEventListener;
  /** @type {Map<any, Map<string, number>>} */
  const live = new Map();
  const bump = (target, type, by) => {
    let types = live.get(target);
    if (types === undefined) live.set(target, (types = new Map()));
    types.set(type, (types.get(type) ?? 0) + by);
  };
  EventTarget.addEventListener = function (type, fn, options) {
    bump(this, type, 1);
    return add.call(this, type, fn, options);
  };
  EventTarget.removeEventListener = function (type, fn, options) {
    bump(this, type, -1);
    return remove.call(this, type, fn, options);
  };
  cleanups.push(async () => {
    EventTarget.addEventListener = add;
    EventTarget.removeEventListener = remove;
    await window.happyDOM.close();
  });
  /** The live listeners of `type` on `target`. */
  const on = (target, type) => live.get(target)?.get(type) ?? 0;
  /** How many targets have live listeners of `type`. */
  const targets = type => [...live].filter(([, types]) => (types.get(type) ?? 0) > 0).length;
  return { window, document, container, on, targets };
};

describe('ren-core event delegation', () => {
  it('listens once per type at the container, not on the nodes', () => {
    const t = setup();
    const root = Root('app');
    const items = $signal(root, [1, 2, 3]);
    const clicks = [];
    render(() => (
      <ul>
        <For each={items}>{item => <li><button onClick={() => clicks.push(item())}>{String(item())}</button></li>}</For>
      </ul>
    ), t.container, { root });
    assert.equal(t.targets('click'), 1, 'one click listener, at the container');
    assert.equal(t.on(t.container, 'click'), 1);
    t.container.querySelectorAll('button')[1].click();
    assert.deepEqual(clicks, [2]);
    $write(items, [3, 1]);
    t.container.querySelectorAll('button')[0].click();
    assert.deepEqual(clicks, [2, 3], 'moved rows keep their handlers');
  });

  it('bubbles from the target up, sets currentTarget, and honours stopPropagation', () => {
    const t = setup();
    const seen = [];
    render(() => (
      <div onClick={e => seen.push(['outer', e.currentTarget.tagName])}>
        <p onClick={e => seen.push(['p', e.currentTarget.tagName])}>
          <b onClick={e => {
            seen.push(['b', e.currentTarget.tagName]);
            if (e.target.id === 'stop') e.stopPropagation();
          }}>
            <i id="go">go</i>
            <i id="stop">stop</i>
          </b>
        </p>
      </div>
    ), t.container);
    t.container.querySelector('#go').click();
    assert.deepEqual(seen, [['b', 'B'], ['p', 'P'], ['outer', 'DIV']]);
    seen.length = 0;
    t.container.querySelector('#stop').click();
    assert.deepEqual(seen, [['b', 'B']], 'stopPropagation stops the delegated walk');
  });

  it('keeps non-bubbling events on their node', () => {
    const t = setup();
    let focused = 0;
    render(() => <input onFocus={() => focused++} />, t.container);
    const input = t.container.querySelector('input');
    assert.equal(t.on(input, 'focus'), 1, 'focus listens on the input itself');
    assert.equal(t.on(t.container, 'focus'), 0);
    input.dispatchEvent(new t.window.Event('focus'));
    assert.equal(focused, 1);
  });

  it('removes its listeners on dispose and runs no handler after', () => {
    const t = setup();
    let clicks = 0;
    const dispose = render(() => <button onClick={() => clicks++} onKeyDown={() => clicks++}>b</button>, t.container);
    const button = t.container.querySelector('button');
    assert.equal(t.on(t.container, 'click'), 1);
    assert.equal(t.on(t.container, 'keydown'), 1);
    dispose();
    assert.equal(t.targets('click'), 0);
    assert.equal(t.targets('keydown'), 0);
    t.container.appendChild(button);
    button.click();
    assert.equal(clicks, 0);
  });

  it('stops a row handler with its row', () => {
    const t = setup();
    const root = Root('app');
    const items = $signal(root, [1, 2]);
    const clicks = [];
    render(() => <div><For each={items}>{item => <a onClick={() => clicks.push(item())}>{String(item())}</a>}</For></div>, t.container, { root });
    const first = t.container.querySelector('a');
    $write(items, [2]);
    // The removed row's node, put back by hand, has a stopped owner.
    t.container.firstChild.appendChild(first);
    first.click();
    assert.deepEqual(clicks, []);
  });

  it('delegates from a portal target outside the container, once per event', () => {
    const t = setup();
    const layer = t.document.createElement('section');
    t.document.body.appendChild(layer);
    const seen = [];
    const dispose = render(() => (
      <div onClick={() => seen.push('view')}>
        <Portal into={layer}><button onClick={() => seen.push('portal')}>p</button></Portal>
        <button id="inside" onClick={() => seen.push('inside')}>i</button>
      </div>
    ), t.container);
    assert.equal(t.on(layer, 'click'), 1);
    layer.querySelector('button').click();
    assert.deepEqual(seen, ['portal']);
    seen.length = 0;
    t.container.querySelector('#inside').click();
    assert.deepEqual(seen, ['inside', 'view']);
    dispose();
    assert.equal(t.targets('click'), 0);
  });

  it('walks once through a portal target inside the container', () => {
    const t = setup();
    const seen = [];
    let target = null;
    render(() => (
      <div onClick={() => seen.push('outer')}>
        <section ref={el => (target = el)} onClick={() => seen.push('section')} />
        {() => <Portal into={target}><button onClick={() => seen.push('button')}>b</button></Portal>}
      </div>
    ), t.container);
    target.querySelector('button').click();
    assert.deepEqual(seen, ['button', 'section', 'outer'], 'each handler once, in bubbling order');
  });

  it('does not cross into a nested root; each root runs its own handlers', () => {
    const t = setup();
    const seen = [];
    const stop = $signal(Root('flag'), false);
    const Inner = () => <button onClick={e => {
      seen.push('inner');
      if ($read(stop)) e.stopPropagation();
    }}>in</button>;
    const outer = Root({
      id: 'outer',
      target: t.container, renderer: $dom(t.container.ownerDocument),
      children: () => (
        <div onClick={() => seen.push('outer')}>
          <Root id="inner">{() => <Inner />}</Root>
        </div>
      ),
    });
    const host = t.container.querySelector('[data-ren-root="outer"]');
    const inner = host.querySelector('[data-ren-root="inner"]');
    assert.equal(t.on(inner, 'click'), 1, 'the nested root listens at its own host');
    inner.querySelector('button').click();
    assert.deepEqual(seen, ['inner', 'outer'], 'once each: the outer walk skips the inner handlers');
    seen.length = 0;
    $write(stop, true);
    inner.querySelector('button').click();
    assert.deepEqual(seen, ['inner'], 'stopping in the nested root stops the outer one');
    $dispose(outer);
    assert.equal(t.targets('click'), 0);
  });

  it('delegates inside a closed shadow root', () => {
    const t = setup();
    let button = null;
    let clicks = 0;
    const root = Root({
      id: 'shade',
      target: t.container,
      renderer: $shadow({ mode: 'closed', styles: false }),
      children: () => <p><button ref={el => (button = el)} onClick={() => clicks++}>s</button></p>,
    });
    const host = t.container.querySelector('[data-ren-root="shade"]');
    assert.ok(host.shadowRoot === null, 'closed');
    assert.equal(t.on(button.getRootNode(), 'click'), 1, 'the listener is on the shadow root');
    button.click();
    assert.equal(clicks, 1);
    $dispose(root);
    assert.equal(t.targets('click'), 0);
  });

  it('sends blur and a bubbling focusout when it removes or hides the focused element, as ren-canv', () => {
    for (const shadow of [false, true]) {
      const t = setup();
      /** @type {any} */
      let shown = null;
      /** @type {any} */
      let kept = null;
      /** @type {any} */
      let rows = null;
      /** @type {string[]} */
      const heard = [];
      const log = (/** @type {string} */ who) => (/** @type {any} */ e) => heard.push(`${who} ${e.type} ${e.relatedTarget === null ? 'none' : 'some'}`);
      /** @type {any} */
      const refs = {};
      const root = Root({
        id: shadow ? 'shade' : 'light',
        target: t.container,
        renderer: shadow ? $shadow({ mode: 'closed', styles: false }) : $dom(t.document),
        children: () => {
          shown = $signal($active(), true);
          kept = $signal($active(), true);
          rows = $signal($active(), ['a', 'b']);
          return (
        <View onFocusOut={log('outer')}>
          <View onFocusOut={log('wrap')}>
            <Action ref={el => (refs.hide = el)} text="hide" hidden={() => !$read(shown)} onBlur={log('own')} />
            <Show when={kept}>
              <Action ref={el => (refs.show = el)} text="show" />
            </Show>
            <For each={rows}>{row => <button id={row} ref={el => (refs[row()] = el)}>{row}</button>}</For>
          </View>
        </View>
          );
        },
      });
      const tag = shadow ? 'shadow' : 'light';
      refs.hide.focus();
      assert.equal(refs.hide.getRootNode().activeElement === refs.hide, true, `${tag}: focused`);
      $write(shown, false);
      assert.deepEqual(heard.splice(0), ['own blur none', 'wrap focusout none', 'outer focusout none'], `${tag}: hidden`);
      refs.show.focus();
      $write(kept, false);
      assert.deepEqual(heard.splice(0), ['wrap focusout none', 'outer focusout none'], `${tag}: removed`);
      refs.b.focus();
      $write(rows, ['a']);
      assert.deepEqual(heard.splice(0), ['wrap focusout none', 'outer focusout none'], `${tag}: a row removed`);
      refs.a.focus();
      $write(rows, []);
      assert.deepEqual(heard.splice(0), ['wrap focusout none', 'outer focusout none'], `${tag}: the rows cleared`);
      $write(shown, true);
      $write(shown, false);
      assert.deepEqual(heard, [], `${tag}: nothing focused, nothing sent`);
      $dispose(root);
    }
  });

  it('delivers what a handler throws to the boundary around its element', () => {
    const window = new Window();
    cleanups.push(() => window.happyDOM.close());
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const root = Root('app');
    const caught = [];
    $catch(root, error => caught.push(error.message));
    const on = $signal(root, true);
    render(() => (
      <div>
        <Recover fallback={(error, reset) => <button onClick={reset}>{`fell back: ${error.message}`}</button>}>
          <button id="inner" onClick={() => {
            throw new Error('inside');
          }}>inner</button>
        </Recover>
        <Show when={on}>
          <button id="outer" onClick={() => {
            $write(on, false);
            throw new Error('outside');
          }}>outer</button>
        </Show>
      </div>
    ), container, { root });
    container.querySelector('#inner').click();
    assert.equal(container.querySelector('button').textContent, 'fell back: inside');
    container.querySelector('button').click();
    assert.equal(container.querySelector('#inner') !== null, true, 'reset rebuilt it');
    container.querySelector('#outer').click();
    assert.deepEqual(caught, ['outside'], 'no boundary around it: the root handler');
    assert.equal(container.querySelector('#outer') === null, true, 'the writes before the throw still flushed');
  });

  it('hears the keys of its root with $keys, after the focused handlers, and nothing outside it', () => {
    const t = setup();
    const { window, document } = t;
    /** @type {string[]} */
    const seen = [];
    let stopping = false;
    const root = Root({
      id: 'spot',
      target: t.container,
      renderer: $dom(document, { styles: false }),
      children: () => {
        $keys(e => {
          seen.push(`root:${e.editable ? 'field:' : ''}${e.ctrlKey ? 'ctrl+' : ''}${e.key}`);
          if (e.key === 'k') e.preventDefault();
        });
        return (
          <View>
            <Edit label="q" value="" onKey={e => {
              seen.push(`edit:${e.key}`);
              if (stopping) /** @type {any} */ (e).stopPropagation();
            }} />
          </View>
        );
      },
    });
    const press = (/** @type {any} */ target, /** @type {string} */ key, ctrl = false) => {
      const e = new window.KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true, cancelable: true, composed: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    assert.equal(press(document.body, 'k', true), true, 'nothing focused: the root hears it, and may prevent it');
    const edit = t.container.querySelector('input');
    press(edit, 'a');
    assert.deepEqual(seen, ['root:ctrl+k', 'edit:a', 'root:field:a'], 'the focused item first, then the root, which knows a field typed it');
    stopping = true;
    press(edit, 'b');
    assert.deepEqual(seen.slice(3), ['edit:b'], 'a focused stopPropagation keeps it from the root');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    press(outside, 'c');
    assert.equal(seen.length, 4, 'a key focused outside the root is not its');
    assert.equal(t.on(document, 'keydown'), 2, "$keys' listener, and the select-all guard of an app root");
    $dispose(root);
    assert.equal(t.on(document, 'keydown'), 0, 'removed with the root');
  });

  it('hears the keys inside a closed shadow root with $keys, which the document cannot see into', () => {
    const t = setup();
    const { window, document } = t;
    /** @type {string[]} */
    const seen = [];
    /** @type {any} */
    let field = null;
    const root = Root({
      id: 'closed-keys',
      target: t.container,
      renderer: $shadow({ mode: 'closed', styles: false }),
      children: () => {
        $keys(e => seen.push(`${e.editable ? 'field:' : ''}${e.key}`));
        return <View><Edit ref={el => (field = el)} label="q" value="" /><Action text="go" /></View>;
      },
    });
    const shadow = field.getRootNode();
    /** A keydown on `el` as a closed root presents it outside: the path from its host on, the target its host. @param {any} el @param {string} key */
    const key = (el, key) => {
      const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
      const path = e.composedPath.bind(e);
      const outside = () => e.currentTarget === document || e.currentTarget === document.body || e.currentTarget === document.documentElement || e.currentTarget === window;
      Object.defineProperty(e, 'composedPath', { value: () => (outside() ? path().slice(path().indexOf(t.container)) : path()) });
      Object.defineProperty(e, 'target', { get: () => (outside() ? t.container : el) });
      el.dispatchEvent(e);
    };
    const input = shadow.querySelector('input');
    const button = shadow.querySelector('button');
    key(input, 'a');
    key(button, 'b');
    assert.deepEqual(seen, ['field:a', 'b'], 'keys focused inside the closed root are its, and a field is known');
    $dispose(root);
    assert.equal(t.on(shadow, 'keydown'), 0, 'the shadow root stops listening with the root');
  });

  it('hears the scrolls around and inside its root with $scrolls, not a sibling\'s', () => {
    const t = setup();
    const { window, document } = t;
    const page = document.createElement('div');
    document.body.appendChild(page);
    page.appendChild(t.container);
    const sibling = document.createElement('div');
    document.body.appendChild(sibling);
    let heard = 0;
    const root = Root({
      id: 'pop',
      target: t.container,
      renderer: $dom(document, { styles: false }),
      children: () => {
        $scrolls(e => {
          if (e.type === 'scroll') heard++;
        });
        return <Scroll><View /></Scroll>;
      },
    });
    const scroll = (/** @type {any} */ target) => target.dispatchEvent(new window.Event('scroll'));
    scroll(t.container.firstChild);
    assert.equal(heard, 1, 'a Scroll inside the root');
    scroll(page);
    assert.equal(heard, 2, 'an element around the root');
    scroll(document);
    assert.equal(heard, 3, 'the page');
    scroll(sibling);
    assert.equal(heard, 3, 'not a sibling\'s');
    assert.equal(t.on(document, 'scroll'), 1);
    $dispose(root);
    assert.equal(t.on(document, 'scroll'), 0, 'removed with the root');
  });

  it('hears a scroll inside its shadow root with $scrolls (scroll events are not composed)', () => {
    const t = setup();
    const { window } = t;
    let box = null;
    let heard = 0;
    const root = Root({
      id: 'shade',
      target: t.container,
      renderer: $shadow({ mode: 'closed', styles: false }),
      children: () => {
        $scrolls(() => heard++);
        return <p><span ref={el => (box = el)}>s</span></p>;
      },
    });
    box.dispatchEvent(new window.Event('scroll'));
    assert.equal(heard, 1);
    assert.equal(t.on(box.getRootNode(), 'scroll'), 1, 'the shadow root listens too');
    $dispose(root);
    assert.equal(t.targets('scroll'), 0);
  });
});
