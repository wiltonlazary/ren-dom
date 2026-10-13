// Background disposal: a clear or replace of a large list, and a content
// swap that drops one, detach the host nodes at once and retire the scopes
// (rrx-core's `$retire`); the root's sweeper frees them later in paced slices. Below
// the threshold, and under Pending, everything stops at once.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { $root, $signal, $read, $write, $stats, $cleanup, $owner, $sweep, $catch, $flush, $task } from 'rrx-core';
import { For, Show, Portal, Pending, $active, Root as App, $roots } from 'ren-core';
import { render, $dom } from 'ren-dom';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';

/** @type {(() => unknown)[]} */
const closing = [];
afterEach(async () => {
  while (closing.length > 0) await closing.pop()();
});

const setup = () => {
  const window = new Window();
  closing.push(() => window.happyDOM.close());
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { window, document, container };
};

/** Frees everything retired, as the Sweeper would. @param {any} root */
const drain = root => {
  let slices = 0;
  while ($sweep(root, 1) > 0) slices++;
  return slices + 1;
};

/** A keyed table whose rows count their cleanups and effect runs. */
const table = (n, options = {}) => {
  const t = setup();
  const root = $root('app');
  const items = $signal(root, Array.from({ length: n }, (_, i) => i));
  const tick = $signal(root, 0);
  const stops = [];
  let runs = 0;
  render(() => (
    <table>
      <tbody>
        <For each={items}>
          {item => {
            $cleanup($owner($active()), () => stops.push(item()));
            return <tr title={() => `${item()}:${$read(tick)}`} onClick={() => runs++}><td>{String(item())}</td></tr>;
          }}
        </For>
      </tbody>
    </table>
  ), t.container, { root, sweep: false, ...options });
  const tbody = t.container.querySelector('tbody');
  return { ...t, root, items, tick, stops, tbody, runs: () => runs };
};

describe('ren-core retire in content an update placed', () => {
  it('clears a large list in the background when its content came from an update', () => {
    const t = setup();
    const root = $root('app');
    const shown = $signal(root, false);
    const items = $signal(root, Array.from({ length: 2000 }, (_, i) => i));
    /** @type {number[]} */
    const stops = [];
    render(() => (
      <div>
        <Show when={shown}>
          <ul>
            <For each={items}>
              {item => {
                $cleanup($owner($active()), () => stops.push(item()));
                return <li>{String(item())}</li>;
              }}
            </For>
          </ul>
        </Show>
      </div>
    ), t.container, { root, sweep: false });
    $write(shown, true);
    assert.equal(t.container.querySelectorAll('li').length, 2000);
    $write(items, []);
    assert.equal(t.container.querySelectorAll('li').length, 0, 'the nodes go at once');
    assert.equal(stops.length, 0, 'the rows are retired, not stopped, in the handler');
    drain(root);
    assert.equal(stops.length, 2000);
  });
});

describe('ren-core background disposal', () => {
  it('clears a large list at once and frees its rows later, each cleanup once', () => {
    const t = table(20, { retire: 10 });
    const first = t.tbody.firstChild;
    const before = $stats(t.root).nodes;
    let cleared = 0;
    let proto = Object.getPrototypeOf(t.tbody);
    while (!Object.getOwnPropertyDescriptor(proto, 'textContent')) proto = Object.getPrototypeOf(proto);
    const own = Object.getOwnPropertyDescriptor(proto, 'textContent');
    Object.defineProperty(t.tbody, 'textContent', { configurable: true, get() { return own.get.call(this); }, set(v) { cleared++; own.set.call(this, v); } });
    $write(t.items, []);
    assert.equal(cleared, 1, 'the host nodes go in one call');
    assert.equal(t.tbody.childNodes.length, 0);
    assert.equal(t.stops.length, 0, 'the rows are retired, not stopped');
    // Retired rows are inert: their bindings and handlers never run again.
    $write(t.tick, 1);
    assert.equal(first.getAttribute('title'), '0:0');
    first.click();
    assert.equal(t.runs(), 0);
    // The list keeps working meanwhile.
    $write(t.items, [7, 8]);
    assert.equal(t.tbody.textContent, '78');
    drain(t.root);
    assert.deepEqual(t.stops.slice().sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i), 'every cleanup ran once');
    assert.ok($stats(t.root).nodes < before, 'the retired rows are freed');
    drain(t.root);
    assert.equal(t.stops.length, 20, 'and only once');
  });

  it('stops a list below the threshold at once', () => {
    const t = table(9, { retire: 10 });
    $write(t.items, []);
    assert.equal(t.stops.length, 9);
    assert.equal($sweep(t.root, 1), 0, 'nothing was retired');
  });

  it('retires on a replace that keeps no row, and a partial removal of at least the threshold', () => {
    const t = table(20, { retire: 10 });
    $write(t.items, Array.from({ length: 20 }, (_, i) => 100 + i));
    assert.equal(t.stops.length, 0, 'no row stays: retired');
    assert.equal(t.tbody.firstChild.textContent, '100');
    assert.equal(t.tbody.childNodes.length, 20);
    drain(t.root);
    assert.equal(t.stops.length, 20);
    // Rows 100 and 119 stay; the 18 removed rows are at least the threshold: retired too.
    const kept = [100, ...Array.from({ length: 18 }, (_, i) => 200 + i), 119];
    $write(t.items, kept);
    assert.equal(t.stops.length, 20, 'a large partial removal waits for the sweep');
    assert.equal(t.tbody.childNodes.length, 20, 'its host nodes went at once');
    assert.equal(t.tbody.firstChild.textContent, '100');
    drain(t.root);
    assert.equal(t.stops.length, 38);
    // A small removal (5 rows, below the threshold) stops at once.
    $write(t.items, kept.slice(0, 15));
    assert.equal(t.stops.length, 43);
    assert.equal($sweep(t.root, 1), 0, 'nothing was retired');
  });

  it('closes portals of rows a large partial removal retires, at once', () => {
    const t = setup();
    const root = $root('app');
    const layer = t.document.createElement('section');
    t.document.body.appendChild(layer);
    const items = $signal(root, Array.from({ length: 15 }, (_, i) => i));
    let stops = 0;
    render(() => (
      <ul>
        <For each={items}>
          {item => {
            $cleanup($owner($active()), () => stops++);
            return <li>{String(item())}<Portal into={layer}><i>{String(item())}</i></Portal></li>;
          }}
        </For>
      </ul>
    ), t.container, { root, retire: 10, sweep: false });
    assert.equal(layer.childNodes.length, 15);
    $write(items, [0, 1, 2]);
    assert.equal(t.container.querySelector('ul').childNodes.length, 3);
    assert.equal(layer.childNodes.length, 3, 'the retired rows closed their portals at once');
    assert.equal(stops, 0);
    drain(root);
    assert.equal(stops, 12);
  });

  it('retires a positional For clear', () => {
    const t = setup();
    const root = $root('app');
    const items = $signal(root, Array.from({ length: 12 }, (_, i) => i));
    let stops = 0;
    render(() => (
      <ul>
        <For by="position" each={items}>
          {item => {
            $cleanup($owner($active()), () => stops++);
            return <li>{() => String(item())}</li>;
          }}
        </For>
      </ul>
    ), t.container, { root, retire: 10, sweep: false });
    $write(items, []);
    assert.equal(t.container.querySelector('ul').childNodes.length, 0);
    assert.equal(stops, 0);
    drain(root);
    assert.equal(stops, 12);
    $write(items, [1, 2]);
    assert.equal(t.container.querySelector('ul').textContent, '12');
  });

  it('retires a content swap that drops a large list, and closes its portal and nested root at once', () => {
    const t = setup();
    const root = $root('app');
    const on = $signal(root, true);
    const items = $signal(root, Array.from({ length: 12 }, (_, i) => i));
    const layer = t.document.createElement('aside');
    t.document.body.appendChild(layer);
    let stops = 0;
    let kept = 0;
    const Small = () => {
      $cleanup($owner($active()), () => kept++);
      return <b>small</b>;
    };
    render(() => (
      <div>
        <Show when={on} fallback={<i>off</i>}>
          <section>
            <Portal into={layer}><p>portal</p></Portal>
            <App id="kid">{() => <em>kid</em>}</App>
            <ul>
              <For each={items}>
                {item => {
                  $cleanup($owner($active()), () => stops++);
                  return <li>{String(item())}</li>;
                }}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={on} fallback={<i>off</i>}><Small /></Show>
      </div>
    ), t.container, { root, retire: 10, sweep: false });
    assert.equal(layer.innerHTML, '<p>portal</p>');
    assert.deepEqual($roots(t.document), ['kid']);
    $write(on, false);
    assert.equal(t.container.innerHTML, '<div><i>off</i><i>off</i></div>');
    assert.equal(stops, 0, 'the large content is retired');
    assert.equal(kept, 1, 'the small content stops at once');
    assert.equal(layer.innerHTML, '', 'the portal leaves at once');
    assert.deepEqual($roots(t.document), [], 'the nested root is disposed at once');
    // Showing it again builds fresh content, the same nested root id included.
    $write(on, true);
    assert.equal(layer.innerHTML, '<p>portal</p>');
    assert.deepEqual($roots(t.document), ['kid']);
    drain(root);
    assert.equal(stops, 12, 'the retired rows were freed');
    assert.equal(layer.innerHTML, '<p>portal</p>', 'the new portal stays');
    assert.deepEqual($roots(t.document), ['kid']);
  });

  it('delivers a throwing retired cleanup to its boundary and frees the rest', () => {
    const t = setup();
    const root = $root('app');
    const caught = [];
    $catch(root, error => caught.push(error.message));
    const items = $signal(root, Array.from({ length: 12 }, (_, i) => i));
    let stops = 0;
    render(() => (
      <ul>
        <For each={items}>
          {item => {
            $cleanup($owner($active()), () => {
              stops++;
              if (item() % 5 === 0) throw new Error(`row ${item()}`);
            });
            return <li>{String(item())}</li>;
          }}
        </For>
      </ul>
    ), t.container, { root, retire: 10, sweep: false });
    $write(items, []);
    assert.equal(t.container.querySelector('ul').childNodes.length, 0);
    drain(root);
    assert.equal(stops, 12);
    assert.deepEqual(caught.sort(), ['row 0', 'row 10', 'row 5']);
  });

  it('never retires under Pending, whose count a retired waiter would hold', () => {
    const t = setup();
    const root = $root('app');
    const items = $signal(root, Array.from({ length: 12 }, (_, i) => i));
    let stops = 0;
    const replies = [];
    const data = $task(root, () => 1, (input, complete) => {
      replies.push(complete);
    });
    render(() => (
      <Pending fallback={<i>wait</i>}>
        <p>{() => $read(data)}</p>
        <ul>
          <For each={items}>
            {item => {
              $cleanup($owner($active()), () => stops++);
              return <li>{String(item())}</li>;
            }}
          </For>
        </ul>
      </Pending>
    ), t.container, { root, retire: 10, sweep: false });
    replies[0]({ ok: true, value: 'ready' });
    $flush(root);
    assert.equal(t.container.querySelector('p').textContent, 'ready');
    $write(items, []);
    assert.equal(stops, 12, 'stopped at once');
  });

  it('finishes the teardown at once when the view is disposed mid-drain', () => {
    const t = setup();
    const items = $signal($root('scratch'), []);
    let stops = 0;
    const root = $root('app');
    const list = $signal(root, Array.from({ length: 3000 }, (_, i) => i));
    void items;
    const dispose = render(() => (
      <ul>
        <For each={list}>
          {() => {
            $cleanup($owner($active()), () => stops++);
            return <li>row</li>;
          }}
        </For>
      </ul>
    ), t.container, { root, retire: 10, sweep: false });
    $write(list, []);
    $sweep(root, 0);
    assert.ok(stops > 0 && stops < 3000, 'partly swept');
    dispose();
    assert.equal(stops, 3000, 'the rest stops with the view');
    assert.equal($stats(root).effects, 0);
  });

  it('keeps every row stopping at once with retire: false', () => {
    const t = table(20, { retire: false });
    $write(t.items, []);
    assert.equal(t.stops.length, 20);
  });
});

describe('ren-core sweep pacing', () => {
  /** Installs fake idle, frame and input scheduling on globalThis; returns the queues. */
  const fake = () => {
    const g = /** @type {any} */ (globalThis);
    const saved = { ric: g.requestIdleCallback, cic: g.cancelIdleCallback, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, nav: Object.getOwnPropertyDescriptor(g, 'navigator') };
    const q = { idle: [], frames: [], input: false, wake: null };
    /** Resolves at the next frame request. @returns {Promise<void>} */
    q.requested = () => new Promise(resolve => (q.wake = resolve));
    g.requestIdleCallback = (fn, options) => q.idle.push({ fn, options }) ;
    g.cancelIdleCallback = id => (q.idle[id - 1] = null);
    g.requestAnimationFrame = fn => {
      const id = q.frames.push(fn);
      if (q.wake !== null) q.wake();
      q.wake = null;
      return id;
    };
    g.cancelAnimationFrame = id => (q.frames[id - 1] = null);
    Object.defineProperty(g, 'navigator', { configurable: true, value: { scheduling: { isInputPending: () => q.input } } });
    closing.push(() => {
      g.requestIdleCallback = saved.ric;
      g.cancelIdleCallback = saved.cic;
      g.requestAnimationFrame = saved.raf;
      g.cancelAnimationFrame = saved.caf;
      if (saved.nav) Object.defineProperty(g, 'navigator', saved.nav);
      else delete g.navigator;
    });
    /** Runs the pending idle callbacks with `ms` of idle time each (clocked by performance.now). */
    q.idleFor = (ms, didTimeout = false) => {
      const list = q.idle;
      q.idle = [];
      for (const entry of list) {
        if (entry === null) continue;
        const end = performance.now() + ms;
        entry.fn({ didTimeout, timeRemaining: () => Math.max(0, end - performance.now()) });
      }
    };
    /** Runs the pending frame callbacks at `time`. */
    q.frame = time => {
      const list = q.frames;
      q.frames = [];
      for (const fn of list) if (fn !== null) fn(time);
    };
    return q;
  };

  it('sweeps in idle periods, reports the drain, and halves its slice after a late frame', () => {
    const q = fake();
    const drains = [];
    const t = table(3000, { retire: 10, sweep: 'idle', swept: d => drains.push(d) });
    $write(t.items, []);
    assert.equal(t.stops.length, 0);
    assert.equal(q.idle.length, 1, 'one idle callback requested');
    assert.equal(q.idle[0].options.timeout, 250, 'a starved queue still sweeps');
    // Frames: on time, then late (the budget halves), then on time again.
    q.frame(1000);
    q.frame(1016.7);
    q.frame(1083);
    // Pending input ends the idle callback before any slice.
    q.input = true;
    q.idleFor(10);
    assert.equal(t.stops.length, 0, 'input first');
    q.input = false;
    for (let i = 0; i < 1000 && t.stops.length < 3000; i++) q.idleFor(1);
    assert.equal(t.stops.length, 3000, 'drained in idle slices');
    assert.equal(drains.length, 1);
    const d = drains[0];
    assert.ok(d.slices >= 1 && d.longest > 0 && d.busy >= d.longest && d.time >= d.busy, JSON.stringify(d));
    assert.equal(d.late, 1, 'one late frame seen');
    assert.equal(q.idle.length, 0, 'no callback left');
  });

  it('sweeps a starved queue in 1 ms slices', () => {
    const q = fake();
    const t = table(20000, { retire: 10, sweep: 'idle' });
    $write(t.items, []);
    q.idleFor(0, true);
    assert.ok(t.stops.length > 0 && t.stops.length < 20000, 'one short slice: part of the work');
    assert.equal(q.idle.length, 1, 'and the next one requested');
  });

  it('sweeps after each frame in frame mode', async () => {
    const q = fake();
    let report = () => {};
    const drained = new Promise(resolve => (report = resolve));
    const t = table(3000, { retire: 10, sweep: 'frame', swept: () => report() });
    $write(t.items, []);
    assert.equal(q.frames.length, 1);
    // Each frame posts one slice; the slice asks for the next frame, or reports the drain.
    for (let time = 0; t.stops.length < 3000; time += 16.7) {
      const next = Promise.race([q.requested(), drained]);
      q.frame(time);
      await next;
    }
    await drained;
  });

  it('drains in macrotask slices in task mode', async () => {
    const drains = [];
    let report = () => {};
    const drained = new Promise(resolve => (report = resolve));
    const t = table(3000, { retire: 10, sweep: 'task', swept: d => (drains.push(d), report()) });
    $write(t.items, []);
    assert.equal(t.stops.length, 0);
    await drained;
    assert.equal(t.stops.length, 3000);
    assert.ok(drains[0].slices >= 1 && drains[0].longest <= drains[0].busy, JSON.stringify(drains[0]));
  });
});

describe('ren-core background disposal in worker mode', () => {
  it('clears at once on the main thread and sweeps in the worker between messages', { timeout: 30000 }, async () => {
    const env = setup();
    const direct = env.document.createElement('div');
    const remote = env.document.createElement('div');
    env.document.body.append(direct, remote);
    const scenario = root => {
      const items = $signal(root, Array.from({ length: 30 }, (_, i) => i));
      let stops = 0;
      const view = () => (
        <ul>
          <For each={items}>
            {item => {
              $cleanup($owner($active()), () => stops++);
              return <li onClick={() => {}}>{String(item())}</li>;
            }}
          </For>
        </ul>
      );
      return { items, view, stops: () => stops };
    };
    const a = $root('app');
    const b = $root('app');
    const left = scenario(a);
    const right = scenario(b);
    render(left.view, direct, { root: a, retire: 10, sweep: false });
    const { port1, port2 } = new MessageChannel();
    const drains = [];
    let report = () => {};
    const drained = new Promise(resolve => (report = resolve));
    const connection = connect(port2, $dom(env.document), remote, { schedule: 'now' });
    const session = serve(right.view, { port: port1, root: b, retire: 10, swept: d => (drains.push(d), report()) });
    closing.push(() => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
    });
    await connection.idle();
    assert.equal(remote.innerHTML, direct.innerHTML);
    $write(left.items, []);
    $write(right.items, []);
    await connection.idle();
    assert.equal(remote.innerHTML, '<ul></ul>');
    assert.equal(remote.innerHTML, direct.innerHTML);
    await drained;
    assert.equal(right.stops(), 30, 'the worker swept every row');
    $write(right.items, [1]);
    await connection.idle();
    assert.equal(remote.innerHTML, '<ul><li>1</li></ul>');
  });
});
