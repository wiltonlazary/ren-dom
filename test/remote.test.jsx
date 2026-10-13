// The worker mode on the DOM renderer: the same components rendered direct
// and through serve/connect over a MessageChannel (both ends in this process)
// must produce the same DOM after every step; events, edits and lanes
// round-trip through the flat protocol.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write, $flush, $stats, $cleanup, $owner, $task, $defer, $batch } from 'rrx-core';
import { Show, For, Choose, When, Portal, Pending, Recover, Render, $active, View, Layout, Label, Edit, Action } from 'ren-core';
import { render, $dom } from 'ren-dom';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';

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

/** @type {(() => void)[]} */
let closing = [];
afterEach(() => {
  for (const close of closing) close();
  closing = [];
});

const setup = () => {
  const window = new Window();
  const document = window.document;
  const direct = document.createElement('div');
  const remote = document.createElement('div');
  document.body.appendChild(direct);
  document.body.appendChild(remote);
  return { window, document, direct, remote };
};

/**
 * Renders the scenario direct into one container and through the worker
 * protocol into another. `scenario(root)` returns `{ view, ...state }`.
 */
const pair = (scenario, options = {}) => {
  const env = setup();
  const a = $root('app');
  const b = $root('app');
  const left = scenario(a);
  const right = scenario(b);
  render(left.view, env.direct, { root: a });
  const { port1, port2 } = new MessageChannel();
  const connection = connect(port2, $dom(env.document), env.remote, { schedule: 'now', ...options.connect });
  const session = serve(right.view, { port: port1, root: b, ...options.serve });
  closing.push(() => {
    connection.close();
    session.close();
    port1.close();
    port2.close();
  });
  const same = async label => {
    await connection.idle();
    assert.equal(env.remote.innerHTML, env.direct.innerHTML, label);
  };
  return { ...env, a, b, left, right, connection, session, same };
};

/**
 * Waits on the connection's own signals, not a guessed delay: `wake()` goes in
 * the hooks that report them (a frame request, an applied message), and
 * `until(done)` resolves at the first of them after which `done()` holds.
 */
const signals = () => {
  let check = () => {};
  return {
    wake: () => check(),
    until: (/** @type {() => boolean} */ done) =>
      new Promise(resolve => {
        check = () => {
          if (!done()) return;
          check = () => {};
          resolve(undefined);
        };
        check();
      }),
  };
};

describe('ren-core worker mode (DOM)', () => {
  it('renders static JSX, components and reactive properties like direct', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const count = $signal(root, 1);
      const name = $signal(root, 'a');
      const Greeting = props => <p class="greet">Hello {props.name}</p>;
      return {
        count,
        name,
        view: () => (
          <>
            <Greeting name="Ada" />
            <span>{1}{' '}{true}{null}{false}</span>
            <p title={() => `n${$read(count)}`} class={name} style={() => ({ color: $read(count) > 1 ? 'red' : 'blue' })}>
              {() => $read(count)}!
            </p>
          </>
        ),
      };
    });
    await t.same('initial');
    assert.equal(t.remote.innerHTML, '<p class="greet">Hello Ada</p><span>1 </span><p title="n1" class="a" style="color: blue;">1!</p>');
    const text = t.remote.querySelectorAll('p')[1].firstChild;
    for (const side of [t.left, t.right]) {
      $write(side.count, 2);
      $write(side.name, 'b');
    }
    await t.same('after writes');
    assert.equal(t.remote.querySelectorAll('p')[1].firstChild, text, 'text updates in place');
  });

  it('keeps keyed rows with For, positional rows with For by position, and moves nodes', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const items = $signal(root, [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }]);
      const letters = $signal(root, ['x', 'y']);
      return {
        items,
        letters,
        view: () => (
          <div>
            <ul>
              <For each={items} by={item => item.id} fallback={<li>empty</li>}>
                {(item, index) => <li>{() => `${index()}${item().t}`}</li>}
              </For>
            </ul>
            <ol><For by="position" each={letters}>{(item, i) => <li>{i}:{item}</li>}</For></ol>
          </div>
        ),
      };
    });
    await t.same('initial');
    const [a, b, c] = [...t.remote.querySelector('ul').children];
    const steps = [
      s => $write(s.items, [{ id: 3, t: 'C' }, { id: 1, t: 'a' }, { id: 2, t: 'b' }]),
      s => $write(s.letters, ['z', 'y', 'w']),
      s => $write(s.items, [{ id: 2, t: 'b' }]),
      s => $write(s.items, []),
      s => $write(s.items, [{ id: 9, t: 'z' }, { id: 8, t: 'q' }]),
      s => $write(s.items, [{ id: 8, t: 'q' }, { id: 9, t: 'z' }]),
    ];
    for (let i = 0; i < steps.length; i++) {
      steps[i](t.left);
      steps[i](t.right);
      await t.same(`step ${i}`);
      if (i === 0) {
        const moved = [...t.remote.querySelector('ul').children];
        assert.ok(moved[0] === c && moved[1] === a && moved[2] === b, 'rows move, not rebuild');
      }
    }
  });

  it('switches Show, Choose, Render and Portal like direct', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const n = $signal(root, 1);
      const which = $signal(root, 'b');
      const open = $signal(root, true);
      const components = { a: () => <em>A</em>, b: () => <strong>B</strong> };
      return {
        n,
        which,
        open,
        view: () => (
          <div>
            <Show when={() => $read(n) > 0} fallback={<i>none</i>}>{value => <b>{() => (value() ? $read(n) : 0)}</b>}</Show>
            <Choose fallback={<span>other</span>}>
              <When when={() => $read(n) === 1}>one</When>
              <When when={() => $read(n) === 2}>two</When>
            </Choose>
            <Render of={() => components[$read(which)]} />
            <Show when={open}><Portal><p class="over">overlay</p></Portal></Show>
          </div>
        ),
      };
    });
    const layer = () => [...t.document.body.querySelectorAll('p.over')].length;
    await t.same('initial');
    assert.equal(layer(), 2, 'both portals render into the layer (body)');
    const steps = [s => $write(s.n, 2), s => $write(s.which, 'a'), s => $write(s.n, 0), s => $write(s.n, 5), s => $write(s.open, false)];
    for (let i = 0; i < steps.length; i++) {
      steps[i](t.left);
      steps[i](t.right);
      await t.same(`step ${i}`);
    }
    assert.equal(layer(), 0, 'portals close with their owner');
  });

  it('shows Pending and Recover boundaries like direct', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const query = $signal(root, 1);
      const n = $signal(root, 1);
      const replies = [];
      const task = $task(root, () => $read(query), (input, complete) => replies.push(complete));
      const Risky = () => <b>{() => {
        if ($read(n) < 0) throw new Error('negative');
        return $read(n);
      }}</b>;
      return {
        query,
        n,
        replies,
        root,
        view: () => (
          <div>
            <Pending fallback={<i>loading</i>}><b>{() => $read(task)}</b></Pending>
            <Recover fallback={(error, reset) => <button onClick={() => {
              $write(n, 1);
              reset();
            }}>{error.message}</button>}>
              <Risky />
            </Recover>
          </div>
        ),
      };
    });
    await t.same('loading');
    for (const s of [t.left, t.right]) {
      s.replies[0]({ ok: true, value: 'ready' });
      $flush(s.root);
    }
    await t.same('ready');
    for (const s of [t.left, t.right]) $write(s.n, -1);
    await t.same('errored');
    assert.match(t.remote.innerHTML, /<button>negative<\/button>/);
    t.direct.querySelector('button').click();
    t.remote.querySelector('button').click();
    await t.same('reset through a forwarded click');
    assert.match(t.remote.innerHTML, /<b>1<\/b>/);
  });

  it('forwards events: one burst per task, one flush per burst', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const a = $signal(root, 0);
      const log = [];
      return {
        a,
        log,
        view: () => (
          <View>
            <Action text="Go" onPress={() => $write(a, $read(a) + 1)} />
            <Label text={() => `n ${$read(a)}`} />
            <input onKeyDown={e => log.push(`${e.key}${e.shiftKey ? '+shift' : ''}`)} />
          </View>
        ),
      };
    });
    await t.same('initial');
    const button = t.remote.querySelector('button');
    button.click();
    button.click();
    button.click();
    await t.connection.idle();
    assert.equal(t.remote.querySelector('span').textContent, 'n 3');
    assert.equal(t.connection.totals.bursts, 1, 'three clicks in one task are one message');
    assert.equal(t.session.counters.events, 3);
    const Keyboard = t.window.KeyboardEvent;
    t.remote.querySelector('input').dispatchEvent(new Keyboard('keydown', { key: 'A', shiftKey: true, bubbles: true }));
    await t.connection.idle();
    assert.deepEqual(t.right.log, ['A+shift'], 'key and modifiers cross as flat fields');
  });

  it('merges superseded pointer motion and sums wheel deltas within a burst', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const moves = [];
      const wheels = [];
      return {
        moves,
        wheels,
        view: () => <div onPointerMove={e => moves.push([e.x, e.y])} onWheel={e => wheels.push(e.deltaY)}>area</div>,
      };
    });
    await t.same('initial');
    const div = t.remote.firstChild;
    const W = t.window;
    for (let i = 1; i <= 5; i++) div.dispatchEvent(new W.PointerEvent('pointermove', { clientX: i * 10, clientY: i, bubbles: true }));
    for (let i = 0; i < 3; i++) div.dispatchEvent(new W.WheelEvent('wheel', { deltaY: 5 }));
    await t.connection.idle();
    assert.deepEqual(t.right.moves, [[50, 5]], 'the latest position wins');
    assert.deepEqual(t.right.wheels, [15], 'wheel deltas add up');
    assert.equal(t.connection.totals.merged, 6);
    const unmerged = pair(root => {
      const moves = [];
      return { moves, view: () => <div onPointerMove={e => moves.push(e.x)}>area</div> };
    }, { connect: { coalesce: false } });
    await unmerged.same('initial');
    for (let i = 1; i <= 3; i++) unmerged.remote.firstChild.dispatchEvent(new unmerged.window.PointerEvent('pointermove', { clientX: i, bubbles: true }));
    await unmerged.connection.idle();
    assert.deepEqual(unmerged.right.moves, [1, 2, 3], 'coalesce: false delivers every event');
  });

  it('round-trips edits and ignores stale value echoes', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const value = $signal(root, 'hi');
      return {
        value,
        view: () => (
          <View>
            <Label text={value} />
            <Edit label="Name" value={value} onChange={e => $write(value, e.value.toUpperCase())} />
          </View>
        ),
      };
    });
    await t.same('initial');
    const input = t.remote.querySelector('input');
    const seen = [];
    t.connection.applied = () => seen.push(input.value);
    // Two keystrokes before the worker answers the first.
    input.value = 'a';
    input.dispatchEvent(new t.window.Event('input', { bubbles: true }));
    await Promise.resolve();
    input.value = 'ab';
    input.dispatchEvent(new t.window.Event('input', { bubbles: true }));
    await t.connection.idle();
    assert.ok(!seen.includes('A'), `the echo of 'a' never replaces the newer 'ab' (saw ${seen.join(',')})`);
    assert.ok(t.connection.totals.stale >= 1, 'the stale echo was skipped');
    assert.equal(input.value, 'AB', 'the answer to the latest edit applies');
    assert.equal(t.remote.querySelector('span').textContent, 'AB');
    // The app writing a value of its own still reaches the field.
    $write(t.right.value, 'reset');
    await t.connection.idle();
    assert.equal(input.value, 'reset');
  });

  it("carries an Edit's runs as data: the same mirror, answered after each edit", { timeout: 30000 }, async () => {
    const words = (/** @type {string} */ v) => v.split(/( )/).filter(t => t !== '').map(t => (t === 'let' ? { text: t, style: { color: '#800080', fontWeight: 700 } } : { text: t }));
    const t = pair(root => {
      const value = $signal(root, 'let x');
      return { value, view: () => <View><Edit value={value} runs={() => words($read(value))} onChange={e => $write(value, e.value)} /></View> };
    });
    await t.connection.idle();
    // The same markup, but for the anchors' names: each host (here in one document) names its own.
    const unnamed = (/** @type {string} */ html) => html.replace(/--ren-_\d+-/g, '--ren-');
    assert.equal(unnamed(t.remote.innerHTML), unnamed(t.direct.innerHTML));
    const input = t.remote.querySelector('input');
    const box = input.nextSibling;
    assert.equal(box.getAttribute('data-ren-mirror'), '');
    assert.equal(box.textContent, 'let x');
    input.value = 'let x let';
    input.dispatchEvent(new t.window.Event('input', { bubbles: true }));
    assert.equal(box.style.display, 'none', 'until the worker answers, the field shows its own text');
    await t.connection.idle();
    assert.equal($read(t.right.value), 'let x let', 'the plain value crossed');
    assert.equal(box.style.display, 'flex');
    assert.deepEqual([...box.firstChild.children].map(s => s.textContent), ['let', ' ', 'x', ' ', 'let']);
  });

  it('cancels default actions synchronously with prevent, in both modes', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const sent = $signal(root, 0);
      return { sent, view: () => <form prevent="submit" onSubmit={() => $write(sent, $read(sent) + 1)}><b>{sent}</b></form> };
    });
    await t.same('initial');
    for (const container of [t.direct, t.remote]) {
      const event = new t.window.Event('submit', { cancelable: true });
      container.querySelector('form').dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }
    await t.same('submitted');
    assert.equal(t.remote.querySelector('b').textContent, '1');
    assert.equal(t.remote.querySelector('form').hasAttribute('prevent'), false, 'prevent is not an attribute');
  });

  it('publishes deferred work behind urgent work, in budgeted slices, in a valid order', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const items = $signal(root, []);
      const count = $signal(root, 0);
      return {
        root,
        items,
        count,
        view: () => (
          <div>
            <button onClick={() => $write(count, $read(count) + 1)}>{() => `clicks ${$read(count)}`}</button>
            <ul><For each={items} by={row => row.id}>{row => <li>{() => `row ${row().id}`}</li>}</For></ul>
          </div>
        ),
      };
    }, { serve: { budget: 1e-6 } });
    await t.same('initial');
    const seen = [];
    const { wake, until } = signals();
    t.connection.applied = info => {
      seen.push({ more: info.more, deferred: info.deferred, rows: t.remote.querySelectorAll('li').length, button: t.remote.querySelector('button').textContent });
      wake();
    };
    const make = Array.from({ length: 300 }, (_, i) => ({ id: i }));
    $defer(t.left.root, () => $write(t.left.items, make));
    $defer(t.right.root, () => $write(t.right.items, make));
    // The first slice is applied; a click answers before the rest of the backlog.
    await until(() => seen.length > 0);
    t.remote.querySelector('button').click();
    t.direct.querySelector('button').click();
    await t.same('after the backlog drains');
    assert.ok(seen.length >= 3, `the deferred rows came in several messages (${seen.length})`);
    assert.ok(seen[0].more && seen[0].deferred > 0 && seen[0].deferred <= 300, 'a slice leaves a backlog');
    const answered = seen.findIndex(s => s.button === 'clicks 1');
    assert.ok(answered >= 0 && seen[answered].more, 'the click was answered while deferred rows still waited');
    assert.equal(t.remote.querySelectorAll('li').length, 300);
    // An urgent structural change promotes the backlog first, so it stays valid.
    $defer(t.left.root, () => $write(t.left.items, make.slice(0, 200)));
    $defer(t.right.root, () => $write(t.right.items, make.slice(0, 200)));
    $write(t.left.items, make.slice(0, 10));
    $write(t.right.items, make.slice(0, 10));
    await t.same('promoted');
    assert.ok(t.session.counters.promotions > 0);
  });

  it('merges work while a message waits for its frame (backpressure) and coalesces properties', { timeout: 30000 }, async () => {
    const frames = [];
    const { wake, until } = signals();
    globalThis.requestAnimationFrame = callback => {
      frames.push(callback);
      wake();
      return frames.length;
    };
    globalThis.cancelAnimationFrame = () => {};
    try {
      const t = pair(root => {
        const n = $signal(root, 0);
        return { n, view: () => <p title={() => `t${$read(n)}`}>{n}</p> };
      }, { connect: { schedule: 'frame' } });
      // The first message (the view, built once the main thread's hello
      // arrives) waits for a frame; nothing more is posted meanwhile.
      await until(() => frames.length > 0);
      assert.equal(t.session.counters.messages, 1, 'the view left');
      for (let i = 1; i <= 10; i++) {
        $write(t.left.n, i);
        $write(t.right.n, i);
      }
      $flush(t.b);
      assert.equal(t.session.counters.messages, 1, 'one message in flight');
      assert.equal(t.remote.innerHTML, '', 'nothing applies before the frame');
      frames.shift()();
      // Its buffers go back; the merged work then arrives and waits for a frame.
      await until(() => frames.length > 0);
      assert.equal(t.session.counters.messages, 2, 'the merged work leaves once the first is applied');
      assert.ok(t.session.counters.coalesced >= 18, `ten updates of two properties coalesced (${t.session.counters.coalesced})`);
      assert.ok(t.session.counters.merged >= 9);
      frames.shift()();
      assert.equal(t.remote.innerHTML, t.direct.innerHTML);
      assert.equal(t.remote.innerHTML, '<p title="t10">10</p>');
    } finally {
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
    }
  });

  it('lets an independent answer to input overtake a held message, and sends a dependent one behind it', { timeout: 30000 }, async () => {
    const frames = [];
    const { wake, until } = signals();
    globalThis.requestAnimationFrame = callback => {
      frames.push(callback);
      wake();
      return frames.length;
    };
    globalThis.cancelAnimationFrame = () => {};
    let applied = 0;
    try {
      const t = pair(root => {
        const bg = $signal(root, 0);
        const n = $signal(root, 0);
        return {
          bg,
          n,
          view: () => (
            <div>
              <i>{() => `bg ${$read(bg)}`}</i>
              <button class="own" onClick={() => $write(n, $read(n) + 1)}>{() => `n ${$read(n)}`}</button>
              <button class="shared" onClick={() => $write(bg, $read(bg) + 10)}>shared</button>
            </div>
          ),
        };
      }, { connect: { schedule: 'frame', applied: () => (applied++, wake()) } });
      await until(() => frames.length > 0);
      frames.shift()();
      assert.equal(t.remote.querySelector('i').textContent, 'bg 0');
      // A background update waits for its frame; the click's answer does not.
      $write(t.right.bg, 1);
      await until(() => frames.length > 0);
      assert.equal(t.remote.querySelector('i').textContent, 'bg 0', 'held for the frame');
      const before = applied;
      t.remote.querySelector('.own').click();
      await until(() => applied > before);
      assert.equal(t.remote.querySelector('.own').textContent, 'n 1', 'the answer overtook the held message');
      assert.equal(t.remote.querySelector('i').textContent, 'bg 0', 'the held message still waits for its frame');
      assert.equal(t.session.counters.overtaken, 1);
      while (frames.length > 0) frames.shift()();
      assert.equal(t.remote.querySelector('i').textContent, 'bg 1');
      // An answer that touches what the held message touched goes at once, behind it.
      $write(t.right.bg, 2);
      await until(() => frames.length > 0);
      const behind = applied;
      t.remote.querySelector('.shared').click();
      // The held message and the answer apply in the one arrival.
      await until(() => applied > behind);
      assert.equal(t.session.counters.hurried, 1);
      assert.equal(t.remote.querySelector('i').textContent, 'bg 12', 'applied in order without waiting for a frame');
    } finally {
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
    }
  });

  it('keeps what deferred work changes in the low lane: properties, text children and list rows', { timeout: 30000 }, async () => {
    /** @type {Record<string, { records: number, deferred: number }>} */
    const seen = {};
    for (const [name, make] of /** @type {[string, (root: any) => any][]} */ ([
      ['property', root => {
        const n = $signal(root, 0);
        return { change: () => $write(n, $read(n) + 1), view: () => <View><Label text={() => `n ${$read(n)}`} /></View> };
      }],
      ['text child', root => {
        const n = $signal(root, 0);
        return { change: () => $write(n, $read(n) + 1), view: () => <div><span>{() => `m ${$read(n)}`}</span></div> };
      }],
      ['keyed list', root => {
        // One row from the start: a compiled row's plan crosses once, urgently, with the first render.
        const rows = $signal(root, /** @type {{ k: number }[]} */ ([{ k: 0 }]));
        let k = 0;
        return { change: () => $write(rows, [{ k: ++k }, ...$read(rows)].slice(0, 5)), view: () => <div><For each={rows}>{row => <p>{row().k}</p>}</For></div> };
      }],
    ])) {
      const total = { records: 0, deferred: 0 };
      const t = pair(make, { connect: { applied: (/** @type {any} */ info) => void ((total.records += info.records), (total.deferred += info.deferred)) } });
      await t.same(`${name}: first render`);
      total.records = total.deferred = 0;
      const promotions = t.session.counters.promotions;
      for (let i = 0; i < 12; i++) {
        $batch(t.b, () => $defer(t.b, () => t.right.change()));
        $batch(t.a, () => $defer(t.a, () => t.left.change()));
        await t.same(`${name}: change ${i}`);
      }
      seen[name] = total;
      assert.ok(total.records > 0, name);
      assert.equal(total.deferred, total.records, `${name}: every record crossed in the low lane`);
      assert.equal(t.session.counters.promotions, promotions, `${name}: nothing promoted`);
    }
  });

  it('delivers posts in their lane and messages back', { timeout: 30000 }, async () => {
    const got = [];
    const t = pair(root => {
      const n = $signal(root, 0);
      return { n, view: () => <b>{n}</b> };
    }, { connect: { message: data => got.push(data) } });
    t.session.host.message = (data, lane) => {
      $write(t.right.n, data);
      t.session.post(`${lane} ${data}`);
    };
    t.connection.post(4, 'background');
    t.connection.post(5);
    await t.connection.idle();
    assert.equal(t.remote.innerHTML, '<b>5</b>');
    assert.deepEqual(got, ['background 4', 'normal 5']);
  });

  it('disposes every binding and node with the view', { timeout: 30000 }, async () => {
    const t = pair(root => {
      const items = $signal(root, [1, 2, 3]);
      return { items, view: () => <div><For each={items}>{item => <i title={() => String(item())} onClick={() => {}}>{item}</i>}</For></div> };
    });
    await t.same('initial');
    const before = $stats(t.b).nodes;
    $write(t.right.items, [3, 4]);
    await t.connection.idle();
    t.session.dispose();
    await t.connection.idle();
    assert.equal(t.remote.innerHTML, '');
    assert.equal($stats(t.b).effects, 0);
    assert.ok($stats(t.b).nodes <= before);
    assert.equal(t.connection.removers.filter(Boolean).length, 0, 'every real listener was removed');
  });

  it('releases main-thread nodes once the worker collects their handles', { timeout: 30000 }, async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc');
    const t = pair(root => {
      const items = $signal(root, Array.from({ length: 50 }, (_, i) => i));
      return { items, view: () => <ul><For each={items}>{item => <li>{item}</li>}</For></ul> };
    });
    await t.same('initial');
    const live = () => t.connection.nodes.filter(n => n != null).length;
    const full = live();
    $write(t.right.items, []);
    await t.connection.idle();
    for (let i = 0; i < 20 && live() > full - 50; i++) {
      gc();
      // GC has no event: a task turn lets the worker's finalizers run.
      await new Promise(resolve => setTimeout(resolve, 10)); // timer: poll
      await t.connection.idle();
    }
    assert.ok(live() <= full - 50, `the rows' nodes were freed (${full} → ${live()})`);
    $write(t.right.items, [1, 2]);
    await t.connection.idle();
    assert.equal(t.remote.innerHTML, '<ul><li>1</li><li>2</li></ul>', 'freed ids are reused safely');
  });

  it('runs in a real worker_threads Worker', { timeout: 30000 }, async () => {
    const { document, remote } = setup();
    const worker = new Worker(new URL('./fixtures/worker.js', import.meta.url));
    const connection = connect(worker, $dom(document), remote, { schedule: 'now' });
    closing.push(() => {
      connection.close();
      worker.terminate();
    });
    await connection.idle();
    assert.equal(remote.innerHTML, '<div><button>add</button><b>0</b></div>');
    remote.querySelector('button').click();
    await connection.idle();
    assert.equal(remote.querySelector('b').textContent, '1');
    connection.post('bump');
    await connection.idle();
    assert.equal(remote.querySelector('b').textContent, '11');
  });
});
