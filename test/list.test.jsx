// The list reconciler: minimal host moves (prefix/suffix trim, swapped ends,
// a longest increasing subsequence for the rest), bulk create and clear,
// lists that own their element, and ren-core semantics (row scopes, Keyed and
// positional For, markers, fallbacks). Mutations are counted with a MutationObserver.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { $root, $signal, $read, $write, $stats, $cleanup, $owner } from 'rrx-core';
import { For, Portal, $active } from 'ren-core';
import { render } from 'ren-dom';

/** @type {any[]} */
const windows = [];
afterEach(async () => {
  while (windows.length > 0) await windows.pop().happyDOM.close();
});

// Node identities are compared with assert.ok(a === b): a failing
// comparison of DOM nodes would make the runner inspect the happy-dom graph.
const setup = () => {
  const window = new Window();
  windows.push(window);
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { window, document, container };
};

/** Counts the nodes added and removed under `target` since the last call. */
const counter = (window, target) => {
  const observer = new window.MutationObserver(() => {});
  observer.observe(target, { childList: true, subtree: true });
  return () => {
    let added = 0;
    let removed = 0;
    let records = 0;
    for (const r of observer.takeRecords()) {
      records++;
      added += r.addedNodes.length;
      removed += r.removedNodes.length;
    }
    return { added, removed, records };
  };
};

/** The length of a longest increasing subsequence (the rows that stay). */
const lis = xs => {
  const tails = [];
  for (const x of xs) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tails[m] < x) lo = m + 1;
      else hi = m;
    }
    tails[lo] = x;
  }
  return tails.length;
};

/** A keyed table of `n` rows in a tbody the list owns. */
const table = n => {
  const t = setup();
  const root = $root('app');
  const items = $signal(root, Array.from({ length: n }, (_, i) => i));
  const stops = [];
  render(() => (
    <table>
      <tbody>
        <For each={items}>
          {item => {
            const R = $active();
            $cleanup($owner(R), () => stops.push(item()));
            return <tr title={() => String(item())}><td>{String(item())}</td></tr>;
          }}
        </For>
      </tbody>
    </table>
  ), t.container, { root });
  const tbody = t.container.querySelector('tbody');
  const text = () => [...tbody.children].map(tr => tr.textContent).join(',');
  const count = counter(t.window, tbody);
  return { ...t, root, items, tbody, text, count, stops };
};

describe('ren-core list reconciler', () => {
  it('owns the element it is the only child of: no markers', () => {
    const t = table(3);
    assert.equal(t.tbody.childNodes.length, 3, 'three rows, no marker nodes');
    assert.equal(t.text(), '0,1,2');
  });

  it('swaps two rows with two moves', () => {
    const t = table(1000);
    const rows = [...t.tbody.children];
    const next = $read(t.items).slice();
    [next[1], next[998]] = [next[998], next[1]];
    $write(t.items, next);
    const c = t.count();
    assert.equal(c.added, 2, 'two rows move');
    assert.ok(t.tbody.children[1] === rows[998], 'rows keep their nodes');
    assert.ok(t.tbody.children[998] === rows[1]);
    assert.equal(t.text(), next.join(','));
  });

  it('reverses with n - 1 moves', () => {
    const t = table(10);
    $write(t.items, $read(t.items).slice().reverse());
    assert.equal(t.count().added, 9);
    assert.equal(t.text(), '9,8,7,6,5,4,3,2,1,0');
  });

  it('moves only the rows off a longest increasing subsequence on a shuffle', () => {
    const t = table(100);
    const next = $read(t.items).slice();
    let seed = 7;
    for (let i = next.length - 1; i > 0; i--) {
      // In 32-bit integer arithmetic (Math.imul): a float product loses its low bits (98 of 99 draws came out even).
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [next[i], next[j]] = [next[j], next[i]];
    }
    $write(t.items, next);
    const c = t.count();
    assert.equal(c.added, 100 - lis(next));
    assert.equal(c.removed, c.added, 'a move is a removal and an insertion; nothing is rebuilt');
    assert.equal(t.text(), next.join(','));
  });

  it('inserts and removes in the middle without moving others', () => {
    const t = table(10);
    const rows = [...t.tbody.children];
    $write(t.items, [0, 1, 2, 3, 4, 100, 5, 6, 7, 8, 9]);
    assert.deepEqual(t.count(), { added: 1, removed: 0, records: 1 });
    $write(t.items, [0, 1, 2, 3, 4, 100, 5, 7, 8, 9]);
    assert.deepEqual(t.count(), { added: 0, removed: 1, records: 1 });
    assert.deepEqual(t.stops, [6], 'the removed row stopped its scope');
    assert.ok(t.tbody.children[0] === rows[0]);
    assert.equal(t.text(), '0,1,2,3,4,100,5,7,8,9');
  });

  it('appends, prepends and mixes moves with inserts and removals', () => {
    const t = table(5);
    $write(t.items, [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(t.count(), { added: 2, removed: 0, records: 2 });
    $write(t.items, [-1, 0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(t.count(), { added: 1, removed: 0, records: 1 });
    $write(t.items, [6, 0, 9, 2, 1, 4, 8]);
    const c = t.count();
    assert.equal(t.text(), '6,0,9,2,1,4,8');
    // Gone: -1, 3, 5. New: 9, 8. Kept order 6,0,2,1,4 has an increasing run of 3 (0,2,4 or 0,1,4).
    assert.equal(c.removed, 3 + 2, 'three removals and two moves');
    assert.equal(c.added, 2 + 2, 'two new rows and two moves');
  });

  it('clears an owned element at once and stops every row', () => {
    const t = table(50);
    const before = $stats(t.root).nodes;
    // Count the host's bulk clears: the textContent setter of the tbody.
    let cleared = 0;
    let proto = Object.getPrototypeOf(t.tbody);
    while (!Object.getOwnPropertyDescriptor(proto, 'textContent')) proto = Object.getPrototypeOf(proto);
    const setter = Object.getOwnPropertyDescriptor(proto, 'textContent').set;
    Object.defineProperty(t.tbody, 'textContent', { configurable: true, set(v) { cleared++; setter.call(this, v); } });
    $write(t.items, []);
    assert.equal(cleared, 1, 'one call removes every row');
    assert.equal(t.tbody.childNodes.length, 0);
    assert.equal(t.stops.length, 50);
    assert.ok($stats(t.root).nodes < before, 'the row nodes are freed');
    $write(t.items, [1, 2]);
    assert.equal(t.text(), '1,2');
  });

  it('replaces every row with one clear and fresh rows', () => {
    const t = table(20);
    $write(t.items, Array.from({ length: 20 }, (_, i) => 100 + i));
    const c = t.count();
    assert.equal(c.removed, 20);
    assert.equal(c.added, 20);
    assert.equal(t.stops.length, 20);
    assert.equal(t.text().split(',')[0], '100');
  });

  it('keeps siblings around a list that does not own its element', () => {
    const { window, container } = setup();
    const root = $root('app');
    const items = $signal(root, ['a', 'b', 'c']);
    render(() => (
      <ul>
        <li>first</li>
        <For each={items}>{item => <li>{item()}</li>}</For>
        <li>last</li>
      </ul>
    ), container, { root });
    const ul = container.querySelector('ul');
    const text = () => [...ul.children].map(li => li.textContent).join(',');
    const count = counter(window, ul);
    $write(items, ['c', 'b', 'a']);
    assert.equal(text(), 'first,c,b,a,last');
    assert.equal(count().added, 2);
    $write(items, []);
    assert.equal(text(), 'first,last', 'a range clear keeps the siblings');
    $write(items, ['x']);
    assert.equal(text(), 'first,x,last');
  });

  it('shows the fallback in an owned element and replaces it', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, []);
    render(() => <ul><For each={items} fallback={<li>none</li>}>{item => <li>{item()}</li>}</For></ul>, container, { root });
    const ul = container.querySelector('ul');
    assert.equal(ul.innerHTML, '<li>none</li>');
    $write(items, ['a', 'b']);
    assert.equal(ul.innerHTML, '<li>a</li><li>b</li>');
    $write(items, []);
    assert.equal(ul.innerHTML, '<li>none</li>', 'the fallback returns after a clear');
  });

  it('moves rows of several nodes as ranges', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, [1, 2, 3]);
    render(() => <div><For each={items}>{item => <><b>{String(item())}</b><i>{String(item())}</i></>}</For></div>, container, { root });
    const div = container.querySelector('div');
    const text = () => [...div.children].map(n => n.textContent).join('');
    $write(items, [3, 1, 2]);
    assert.equal(text(), '331122');
    $write(items, [2, 3]);
    assert.equal(text(), '2233');
    $write(items, []);
    assert.equal(text(), '');
  });

  it('keeps positional rows with For by position and follows the values', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, ['a', 'b', 'c']);
    let built = 0;
    render(() => <ul><For by="position" each={items}>{item => (built++, <li>{item}</li>)}</For></ul>, container, { root });
    const ul = container.querySelector('ul');
    const first = ul.firstChild;
    $write(items, ['c', 'b', 'a', 'd']);
    assert.equal(ul.textContent, 'cbad');
    assert.ok(ul.firstChild === first, 'the first position keeps its row');
    assert.equal(built, 4);
    $write(items, ['z']);
    assert.equal(ul.textContent, 'z');
  });

  it('passes an index accessor only to children that take one', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, ['a', 'b']);
    render(() => <ul><For each={items}>{(item, index) => <li>{() => `${index()}${item()}`}</li>}</For></ul>, container, { root });
    const ul = container.querySelector('ul');
    assert.equal(ul.textContent, '0a1b');
    $write(items, ['b', 'a']);
    assert.equal(ul.textContent, '0b1a');
  });

  it('keeps a portal in the owned element untouched by a clear of another list', () => {
    const { container, document } = setup();
    const root = $root('app');
    const items = $signal(root, [1, 2]);
    render(() => (
      <div>
        <ul><For each={items}>{item => <li>{String(item())}</li>}</For></ul>
        <Portal into={document.body}><p>outside</p></Portal>
      </div>
    ), container, { root });
    $write(items, []);
    assert.equal(container.querySelector('ul').innerHTML, '');
    assert.equal(document.body.lastChild.textContent, 'outside');
  });
});
