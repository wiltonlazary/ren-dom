// Application roots: many roots on one document, each confined by its id,
// with its own graph, renderer (dom, shadow), theme, contexts, storage
// namespace, locks and, in the worker runtime, its own worker end. happy-dom;
// the worker runs over a MessageChannel.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import {
  Root, $roots, $signal, $read, $write, $effect, $dispose, $context, $lookup, $update, $entries, $task,
  Id, Storage, Locks, Runtime, Props, Send, $name, $settle,
  Show, For, Portal, Pending, Label, Action, View, $active,
} from 'ren-core';
import { $dom, $shadow } from 'ren-dom';
import { serve } from 'ren-core/worker';
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


const setup = () => {
  const window = new Window();
  const document = window.document;
  const page = document.createElement('main');
  document.body.appendChild(page);
  return { window, document, page };
};

/** A lock manager that records requests. */
const manager = () => {
  /** @type {string[]} */
  const names = [];
  return {
    names,
    /** @param {string} name @param {any} _options @param {(lock: any) => any} callback */
    request: async (name, _options, callback) => {
      names.push(name);
      return callback({ name });
    },
    query: async () => ({ held: names.map(name => ({ name })), pending: [] }),
  };
};

/**
 * Resolves at the first message on `port` after which `done()` holds (the
 * connection, listening first, has applied it by then).
 * @param {MessagePort} port @param {() => boolean} done @returns {Promise<void>}
 */
const until = (port, done) =>
  new Promise(resolve => {
    if (done()) return resolve();
    const check = () => {
      if (!done()) return;
      port.removeEventListener('message', check);
      resolve();
    };
    port.addEventListener('message', check);
  });

describe('ren-core roots', () => {
  it('confines roots with different renderers and themes on one document', () => {
    const { document, page } = setup();
    /** @type {any} */
    const seen = {};
    const Probe = () => {
      seen[$lookup(Id)] = { runtime: $lookup(Runtime).renderer, name: $name('field') };
      return <Label text={$lookup(Id)} />;
    };
    const main = Root({ id: 'main', target: page, renderer: $dom(document, { theme: { accent: 0xff112233 } }), children: <Probe /> });
    const side = Root({ id: 'side', target: page, renderer: $shadow({ theme: { accent: 0xff445566 } }), children: () => <Probe /> });
    assert.deepEqual($roots(document).sort(), ['main', 'side']);
    assert.deepEqual(seen, {
      main: { runtime: 'dom', name: 'main-field' },
      side: { runtime: 'shadow', name: 'side-field' },
    });
    const [a, b] = page.children;
    assert.equal(a.getAttribute('data-ren-root'), 'main');
    assert.equal(b.getAttribute('data-ren-root'), 'side');
    // Theme tokens live on each host, never on the document.
    assert.equal(a.style.getPropertyValue('--ren-accent'), 'rgba(17, 34, 51, 1)');
    assert.equal(b.style.getPropertyValue('--ren-accent'), 'rgba(68, 85, 102, 1)');
    assert.equal(document.documentElement.getAttribute('style'), null);
    assert.equal(document.head.children.length, 0);
    // The light-DOM root carries a scoped <style>; the shadow root adopts its sheet.
    assert.equal(a.firstChild.tagName, 'STYLE');
    assert.match(a.firstChild.textContent, /\[data-ren-root="main"\] \[data-ren="Action"\]:not\(\[data-ren-root="main"\] \[data-ren-root\] \*\)/);
    assert.equal(a.textContent.endsWith('main'), true);
    assert.equal(b.shadowRoot.adoptedStyleSheets.length, 1);
    assert.equal(b.shadowRoot.textContent, 'side');
    assert.equal(b.children.length, 0);
    $dispose(main);
    $dispose(side);
    assert.equal(page.children.length, 0);
    assert.deepEqual($roots(document), []);
  });

  it('refuses a duplicate live id per document, and frees it on dispose', () => {
    const one = setup();
    const two = setup();
    const a = Root({ id: 'app', target: one.page, renderer: $dom(one.page.ownerDocument), children: 'a' });
    assert.throws(() => Root({ id: 'app', target: one.page, renderer: $dom(one.page.ownerDocument), children: 'b' }), /root "app" is already live in this document/);
    assert.equal(one.page.children.length, 1);
    const b = Root({ id: 'app', target: two.page, renderer: $dom(two.page.ownerDocument), children: 'b' });
    assert.throws(() => Root({ id: 'Bad', target: one.page, renderer: $dom(one.page.ownerDocument) }), /root id must match/);
    $dispose(a);
    const again = Root({ id: 'app', target: one.page, renderer: $dom(one.page.ownerDocument), children: 'again' });
    assert.equal(one.page.textContent.endsWith('again'), true);
    $dispose(again);
    $dispose(b);
  });

  it('keeps graphs apart: a write in one root never runs the other root\'s effects', () => {
    const { page } = setup();
    let left = 0;
    let right = 0;
    /** @type {any} */
    let count = null;
    const A = () => {
      count = $signal($active(), 0);
      return <Label text={() => (left++, String($read(count)))} />;
    };
    const B = () => {
      $effect($active(), () => void right++);
      return <Label text={() => (right++, 'b')} />;
    };
    const a = Root({ id: 'a', target: page, renderer: $dom(page.ownerDocument), children: <A /> });
    const b = Root({ id: 'b', target: page, renderer: $dom(page.ownerDocument), children: <B /> });
    assert.deepEqual([left, right], [1, 2]);
    $write(count, 5);
    $write(count, 6);
    assert.deepEqual([left, right], [3, 2]);
    assert.equal(page.children[0].textContent.endsWith('6'), true);
    $dispose(a);
    $dispose(b);
  });

  it('isolates pending state: one root waiting never holds another', async () => {
    const { page } = setup();
    /** @type {((value: string) => void) | null} */
    let finish = null;
    const Slow = () => {
      const task = $task($active(), () => 1, (/** @type {number} */ _input, /** @type {(result: any) => void} */ complete) => {
        finish = value => complete({ ok: true, value });
      });
      return (
        <Pending fallback="waiting">
          <Label text={() => $read(task)} />
        </Pending>
      );
    };
    const slow = Root({ id: 'slow', target: page, renderer: $dom(page.ownerDocument), children: <Slow /> });
    const fast = Root({ id: 'fast', target: page, renderer: $dom(page.ownerDocument), children: <Pending fallback="waiting"><Label text="ready" /></Pending> });
    assert.equal(page.children[0].textContent.endsWith('waiting'), true);
    assert.equal(page.children[1].textContent.endsWith('ready'), true);
    /** @type {any} */ (finish)('done');
    await $settle(slow);
    assert.equal(page.children[0].textContent.endsWith('done'), true);
    assert.equal(page.children[1].textContent.endsWith('ready'), true);
    $dispose(slow);
    $dispose(fast);
  });

  it('namespaces storage, its events and locks by id', async () => {
    const { window, page } = setup();
    const storage = window.localStorage;
    storage.setItem('other', 'x');
    const locks = manager();
    /** @type {any} */
    const shelves = {};
    /** @type {any[]} */
    const events = [];
    /** @type {string[]} */
    const shown = [];
    const App = () => {
      const shelf = /** @type {any} */ ($lookup(Storage));
      shelves[$lookup(Id)] = shelf;
      $lookup(Locks).request('save', () => 'saved');
      return <Label text={() => (shown.push(`${$lookup(Id)}:${shelf.get('k')}`), String(shelf.get('k')))} />;
    };
    const a = Root({ id: 'a', target: page, renderer: $dom(page.ownerDocument), storage, locks, children: <App /> });
    const b = Root({ id: 'b', target: page, renderer: $dom(page.ownerDocument), storage, locks, children: <App /> });
    const [ha, hb] = page.children;
    ha.addEventListener('ren:storage', (/** @type {any} */ e) => events.push(['a', e.detail]));
    hb.addEventListener('ren:storage', (/** @type {any} */ e) => events.push(['b', e.detail]));
    shelves.a.set('k', '1');
    assert.equal(storage.getItem('ren:a:k'), '1');
    assert.equal(storage.getItem('ren:b:k'), null);
    assert.equal(shelves.b.get('k'), null);
    assert.deepEqual(shelves.a.keys(), ['k']);
    assert.deepEqual(shelves.b.keys(), []);
    assert.deepEqual(events, [['a', { id: 'a', key: 'k', value: '1' }]]);
    assert.deepEqual(shown, ['a:null', 'b:null', 'a:1']);
    // Another tab writes b's key: only b follows.
    storage.setItem('ren:b:k', '2');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'ren:b:k', newValue: '2', storageArea: storage }));
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'other', newValue: 'y', storageArea: storage }));
    assert.deepEqual(events.slice(1), [['b', { id: 'b', key: 'k', value: '2' }]]);
    assert.deepEqual(shown.slice(3), ['b:2']);
    shelves.a.clear();
    assert.equal(storage.getItem('ren:b:k'), '2');
    assert.equal(storage.getItem('other'), 'x');
    assert.deepEqual(locks.names, ['ren:a:save', 'ren:b:save']);
    assert.deepEqual(await $lookup(a, Locks).query(), { held: ['save'], pending: [] });
    $dispose(a);
    $dispose(b);
    // A disposed root no longer follows storage events.
    const before = events.length;
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'ren:b:k', newValue: '3', storageArea: storage }));
    assert.equal(events.length, before);
  });

  it('provides contexts across components, lists, branches, portals and boundaries; Update stays in its subtree', () => {
    const { page } = setup();
    const Theme = $context('light');
    /** @type {string[]} */
    const seen = [];
    const Show1 = (/** @type {{ at: string }} */ props) => <Label text={() => `${props.at}=${$lookup(Theme)}`} />;
    const Switcher = () => <Action text="go" onPress={() => $update(Theme, value => `${value}+`)} />;
    const root = Root({
      id: 'ctx',
      target: page, renderer: $dom(page.ownerDocument),
      children: () => (
        <View>
          <Show1 at="outside" />
          <Theme value="dark">
            <Show1 at="lazy" />
            <Show when={() => true}>
              <Show1 at="show" />
            </Show>
            <For each={['x']}>{() => <Show1 at="for" />}</For>
            <For by="position" each={['y']}>{() => <Show1 at="index" />}</For>
            <Pending fallback="...">
              <Show1 at="loading" />
            </Pending>
            <Portal>
              <Show1 at="portal" />
            </Portal>
            <Theme value="blue">
              <Show1 at="inner" />
              <Switcher />
              {() => (seen.push($entries().map(([, v]) => String(v)).join(',')), null)}
            </Theme>
          </Theme>
        </View>
      ),
    });
    const text = () => [...page.querySelectorAll('[data-ren="Label"]')].map(n => n.textContent);
    // The portal renders into the root's layer (its host) as it opens, ahead of the view.
    assert.deepEqual(text(), ['portal=dark', 'outside=light', 'lazy=dark', 'show=dark', 'for=dark', 'index=dark', 'loading=dark', 'inner=blue']);
    // The inner provider's entries: itself, the outer one shadowed away, then the root's built-ins.
    assert.equal(seen[0].startsWith('blue,'), true);
    assert.equal(seen[0].includes('dark'), false);
    assert.equal(seen[0].includes('ctx'), true);
    page.querySelector('[data-ren="Action"]').click();
    assert.deepEqual(text(), ['portal=dark', 'outside=light', 'lazy=dark', 'show=dark', 'for=dark', 'index=dark', 'loading=dark', 'inner=blue+']);
    assert.throws(() => $update(root, Id, 'x'), /read-only/);
    $dispose(root);
  });

  it('nests a root with another renderer, isolated, with props in and messages out', () => {
    const { document, page } = setup();
    const Theme = $context('none');
    /** @type {any} */
    let count = null;
    /** @type {any[]} */
    const messages = [];
    /** @type {any} */
    const inside = {};
    const Child = () => {
      inside.id = $lookup(Id);
      inside.theme = $lookup(Theme);
      inside.storage = $lookup(Storage);
      return (
        <View>
          <Label text={() => `child ${$lookup(Props)}`} />
          <Action text="send" onPress={() => $lookup(Send)({ from: $lookup(Id) })} />
        </View>
      );
    };
    const parent = Root({
      id: 'parent',
      target: page, renderer: $dom(page.ownerDocument),
      storage: null,
      children: () => (
        (count = $signal($active(), 1)),
        <Theme value="parent-theme">
          <Label text="before" />
          <Root id="kid" renderer={$shadow({ theme: { ink: 0xff010203 } })} props={() => $read(count)} onMessage={data => messages.push([$lookup(Theme), data])}>
            {() => <Child />}
          </Root>
          <Label text="after" />
          <Root id="plain" storage={null}>
            <Label text="plain" />
          </Root>
        </Theme>
      ),
    });
    const host = page.firstChild;
    const kid = host.querySelector('[data-ren-root="kid"]');
    // The parent kept building with its own renderer after the nested root.
    assert.deepEqual([...host.querySelectorAll('[data-ren="Label"]')].map(n => n.textContent), ['before', 'after', 'plain']);
    assert.equal(kid.shadowRoot.querySelector('[data-ren="Label"]').textContent, 'child 1');
    assert.equal(kid.style.getPropertyValue('--ren-ink'), 'rgba(1, 2, 3, 1)');
    assert.equal(host.style.getPropertyValue('--ren-ink'), 'rgba(38, 62, 52, 1)');
    // Nothing of the parent's context crosses: not its providers, not its storage.
    assert.deepEqual({ ...inside, storage: inside.storage === null ? null : 'shelf' }, { id: 'kid', theme: 'none', storage: 'shelf' });
    $write(count, 2);
    assert.equal(kid.shadowRoot.querySelector('[data-ren="Label"]').textContent, 'child 2');
    kid.shadowRoot.querySelector('[data-ren="Action"]').click();
    assert.deepEqual(messages, [['parent-theme', { from: 'kid' }]]);
    // A nested root without a renderer gets the parent host's nest(): the light DOM.
    assert.equal(host.querySelector('[data-ren-root="plain"]').textContent.endsWith('plain'), true);
    assert.deepEqual($roots(document).sort(), ['kid', 'parent', 'plain']);
    $dispose(parent);
    assert.deepEqual($roots(document), []);
    assert.equal(kid.shadowRoot.childNodes.length, 0);
    assert.equal(kid.shadowRoot.adoptedStyleSheets.length, 0);
    assert.equal(page.children.length, 0);
    void document;
  });

  it('passes contexts into a root only when provided explicitly', () => {
    const { page } = setup();
    const Theme = $context('none');
    const Tone = () => <Action text={() => $lookup(Theme)} onPress={() => $update(Theme, 'changed')} />;
    const root = Root({ id: 'given', target: page, renderer: $dom(page.ownerDocument), provide: [[Theme, 'given']], storage: null, children: <Tone /> });
    const action = page.querySelector('[data-ren="Action"]');
    assert.equal(action.textContent, 'given');
    action.click();
    assert.equal(action.textContent, 'changed');
    assert.equal($lookup(root, Storage), null);
    assert.equal($lookup(root, Id), 'given');
    assert.equal($name(root, 'field'), 'given-field');
    assert.equal($entries(root).find(([context]) => context === Id)?.[1], 'given');
    $dispose(root);
  });

  it('runs a worker-runtime root on its own port, with its id, storage, props and messages', { timeout: 30000 }, async t => {
    const { window, document, page } = setup();
    const storage = window.localStorage;
    storage.setItem('ren:side:greeting', 'hello');
    storage.setItem('ren:main:greeting', 'not mine');
    const { port1, port2 } = new MessageChannel();
    // The worker side: its own root, with the same id.
    const worker = Root('side');
    /** @type {any} */
    let shelf = null;
    const session = serve(
      () => {
        shelf = $lookup(Storage);
        return (
          <View>
            <Label text={() => `${$lookup(Id)} ${shelf.get('greeting')} ${$lookup(Props) ?? '-'}`} />
            <Action text="save" onPress={() => (shelf.set('saved', 'yes'), $lookup(Send)('saved'))} />
          </View>
        );
      },
      { port: port1, root: worker },
    );
    // Closed after the test however it ends, a timeout too.
    closeAfter(t, () => {
      session.close();
      port1.close();
      port2.close();
    });
    /** @type {any[]} */
    const messages = [];
    let terminated = 0;
    const main = Root({
      id: 'side',
      target: page,
      storage,
      runtime: 'worker',
      worker: () => Object.assign(port2, { terminate: () => (terminated++, port2.close()) }),
      renderer: $dom(document),
      props: 'p1',
      onMessage: data => messages.push(data),
      connect: { schedule: 'now' },
    });
    const connection = /** @type {any} */ ($lookup(main, Runtime)).connection;
    await connection.idle();
    const host = page.firstChild;
    assert.equal(host.getAttribute('data-ren-root'), 'side');
    assert.equal(host.querySelector('[data-ren="Label"]').textContent, 'side hello p1');
    // A worker write reaches the main thread's storage under the root's prefix, in one message.
    host.querySelector('[data-ren="Action"]').click();
    await connection.idle();
    assert.equal(storage.getItem('ren:side:saved'), 'yes');
    assert.deepEqual(messages, ['saved']);
    // Another tab's write to this root's key reaches the worker's mirror.
    storage.setItem('ren:side:greeting', 'bonjour');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'ren:side:greeting', newValue: 'bonjour', storageArea: storage }));
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'ren:main:greeting', newValue: 'no', storageArea: storage }));
    // idle() sends the mirror writes this task queued before it asks.
    await connection.idle();
    assert.equal(host.querySelector('[data-ren="Label"]').textContent, 'side bonjour p1');
    assert.deepEqual(shelf.keys(), ['greeting', 'saved']);
    $dispose(main);
    assert.equal(terminated, 1);
    assert.equal(page.children.length, 0);
  });

  it('leaves no globals and no window listeners behind', () => {
    const { window, document, page } = setup();
    const keys = Object.keys(globalThis).sort();
    /** @type {Map<string, number>} */
    const listening = new Map();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    /** @type {any} */ (window).addEventListener = (/** @type {string} */ name, /** @type {any} */ fn, /** @type {any} */ options) => {
      listening.set(name, (listening.get(name) ?? 0) + 1);
      add(name, fn, options);
    };
    /** @type {any} */ (window).removeEventListener = (/** @type {string} */ name, /** @type {any} */ fn) => {
      listening.set(name, (listening.get(name) ?? 0) - 1);
      remove(name, fn);
    };
    const roots = [
      Root({ id: 'one', target: page, renderer: $dom(page.ownerDocument), children: <Label text="1" /> }),
      Root({ id: 'two', target: page, renderer: $shadow({ mode: 'closed' }), children: <Label text="2" /> }),
    ];
    assert.equal(listening.get('storage'), 2);
    for (const root of roots) $dispose(root);
    assert.equal(listening.get('storage'), 0);
    assert.deepEqual(Object.keys(globalThis).sort(), keys);
    assert.equal(page.childNodes.length, 0);
    assert.equal(document.head.childNodes.length, 0);
    assert.deepEqual($roots(document), []);
  });

  it('lets the error of a failed attachShadow through, and closes cleanly', () => {
    const { document, page } = setup();
    // A document without shadow roots (ren-html's) refuses them with its own error.
    const make = document.createElement.bind(document);
    /** @type {any} */ (document).createElement = (/** @type {string} */ tag, /** @type {any} */ options) => {
      const el = make(tag, options);
      el.attachShadow = () => {
        throw new Error('REN html: shadow roots are not rendered by $html; use $dom');
      };
      return el;
    };
    assert.throws(() => Root({ id: 'side', target: page, renderer: $shadow(), children: <Label text="x" /> }), /^Error: REN html: shadow roots are not rendered by \$html; use \$dom$/);
    for (const el of page.querySelectorAll('*')) assert.equal(el.getAttribute('data-ren-root'), null, 'the host is let go');
  });

  it('builds a nested root with its first props in place, direct and in a worker', { timeout: 30000 }, async t => {
    const { document, page } = setup();
    /** @type {any[]} */
    const seen = [];
    const Child = () => {
      seen.push($lookup(Props));
      return <Label text={() => `props ${$lookup(Props)}`} />;
    };
    const { port1, port2 } = new MessageChannel();
    /** @type {any[]} */
    const built = [];
    const Remote = () => {
      // Read once, as a style object is: the worker builds only once its props are in place.
      built.push($lookup(Props));
      return <Label text={() => `worker props ${$lookup(Props)}`} />;
    };
    const session = serve(() => <Remote />, { port: port1, root: Root('inner-worker') });
    /** @type {any} */
    let outer = null;
    // Closed after the test however it ends, a timeout too (a finally would wait on a hung await).
    closeAfter(t, () => {
      if (outer !== null) $dispose(outer);
      session.close();
      port1.close();
      port2.close();
    });
    outer = Root({
    id: 'outer',
    target: page,
    storage: null,
    locks: null,
    renderer: $dom(document),
    children: () => (
      <View>
        <Root id="inner" props={42}>
          {() => <Child />}
        </Root>
        <Root id="inner-worker" runtime="worker" worker={port2} props={7} connect={{ schedule: 'now' }} />
      </View>
    ),
    });
    assert.deepEqual(seen, [42], 'the first build read its props');
    const label = (/** @type {string} */ id) => /** @type {any} */ (page.querySelector(`[data-ren-root="${id}"] [data-ren="Label"]`))?.textContent;
    assert.equal(label('inner'), 'props 42');
    await until(port2, () => label('inner-worker') === 'worker props 7');
    assert.equal(label('inner-worker'), 'worker props 7', 'the worker got its first props with no change');
    assert.deepEqual(built, [7], 'the worker built once, with its first props');
  });

  it('takes a new theme at once: the host\'s tokens change, the view and its nodes stay', () => {
    const { document, page } = setup();
    const renderer = $dom(document, { theme: { accent: 0xff112233 } });
    const root = Root({ id: 'themed', target: page, renderer, storage: null, locks: null, children: () => <Action text="go" /> });
    const host = /** @type {any} */ (page.querySelector('[data-ren-root="themed"]'));
    const button = host.querySelector('[data-ren="Action"]');
    assert.equal(host.style.getPropertyValue('--ren-accent'), 'rgba(17, 34, 51, 1)');
    /** @type {any} */ (renderer).setTheme({ accent: 0xff445566 });
    assert.equal(host.style.getPropertyValue('--ren-accent'), 'rgba(68, 85, 102, 1)');
    assert.equal(host.querySelector('[data-ren="Action"]'), button, 'the same nodes');
    $dispose(root);
  });
});

