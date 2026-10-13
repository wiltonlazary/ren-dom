// The worker mode's shared mailbox: messages written to a SharedArrayBuffer
// slot and announced by a bell apply the same DOM as the message path, and
// an answer to input applies from a frame poll before its bell arrives.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { $root, $signal, $read, $write } from 'rrx-core';
import { For, Show } from 'ren-core';
import { render, $dom } from 'ren-dom';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';

/** @type {(() => any)[]} */
let closing = [];
afterEach(async () => {
  const now = closing;
  closing = [];
  for (const close of now) await close();
});

const BELL = 6;

/** A MessagePort whose incoming bells can be held back and released later. */
const holding = port => {
  const held = [];
  /** @type {(() => void) | null} */
  let rung = null;
  const wrapper = {
    hold: false,
    held,
    /** Resolves when the next bell is held back. @returns {Promise<void>} */
    bell: () => new Promise(resolve => (rung = resolve)),
    postMessage: (data, transfer) => port.postMessage(data, transfer),
    addEventListener: (type, listener) =>
      port.addEventListener(type, event => {
        if (wrapper.hold && event.data[0] === BELL) {
          held.push(() => listener(event));
          if (rung !== null) rung();
          rung = null;
        } else listener(event);
      }),
    removeEventListener: () => {},
    start: () => port.start(),
    release: () => {
      wrapper.hold = false;
      while (held.length > 0) held.shift()();
    },
  };
  return wrapper;
};

const scenario = root => {
  const items = $signal(root, [1, 2, 3]);
  const name = $signal(root, 'ada');
  const on = $signal(root, true);
  const count = $signal(root, 0);
  const view = () => (
    <div>
      <button onClick={() => $write(count, $read(count) + 1)}>{() => `n${$read(count)}`}</button>
      <p title={() => `hi ${$read(name)}`} style={() => ({ color: $read(on) ? 'red' : 'blue' })}>{name}</p>
      <ul>
        <For each={items} by={x => x}>{x => <li class={() => ($read(on) ? 'on' : 'off')}>{`item ${x()} é ✓`}</li>}</For>
      </ul>
      <Show when={on} fallback={<i>off</i>}><b>shown</b></Show>
    </div>
  );
  return { items, name, on, count, view };
};

const setup = options => {
  const window = new Window();
  const document = window.document;
  const direct = document.createElement('div');
  const remote = document.createElement('div');
  document.body.append(direct, remote);
  const a = $root('app');
  const b = $root('app');
  const left = scenario(a);
  const right = scenario(b);
  render(left.view, direct, { root: a });
  const { port1, port2 } = new MessageChannel();
  const port = holding(port2);
  const infos = [];
  const connection = connect(port, $dom(document), remote, { schedule: 'now', mailbox: true, applied: info => infos.push({ ...info }), ...options });
  const session = serve(right.view, { port: port1, root: b });
  closing.push(() => {
    connection.close();
    session.close();
    port1.close();
    port2.close();
    return window.happyDOM.close();
  });
  return { window, direct, remote, a, b, left, right, connection, session, port, infos };
};

describe('ren-core worker mailbox', () => {
  it('applies messages from the shared mailbox as the message path would', { timeout: 30000 }, async () => {
    const t = setup();
    await t.connection.idle();
    assert.equal(t.remote.innerHTML, t.direct.innerHTML, 'initial');
    const steps = [
      s => $write(s.items, [3, 1, 2, 4]),
      s => $write(s.name, 'grace hopper, ü'),
      s => $write(s.on, false),
      s => $write(s.items, []),
      s => $write(s.on, true),
    ];
    for (const step of steps) {
      step(t.left);
      step(t.right);
      await t.connection.idle();
      assert.equal(t.remote.innerHTML, t.direct.innerHTML);
    }
    t.remote.querySelector('button').click();
    t.direct.querySelector('button').click();
    await t.connection.idle();
    assert.equal(t.remote.querySelector('button').textContent, 'n1');
    assert.equal(t.remote.innerHTML, t.direct.innerHTML);
    assert.ok(t.connection.totals.boxed > 0, 'messages came through the mailbox');
    assert.equal(t.connection.totals.boxed, t.session.counters.boxed);
    assert.ok(t.connection.totals.messages > t.connection.totals.boxed, 'style objects still go by message');
  });

  it('applies an answer from the mailbox in the next frame, before its bell', { timeout: 30000 }, async () => {
    const g = /** @type {any} */ (globalThis);
    const frames = [];
    const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
    g.requestAnimationFrame = fn => frames.push(fn);
    g.cancelAnimationFrame = id => (frames[id - 1] = null);
    closing.push(() => {
      g.requestAnimationFrame = saved.raf;
      g.cancelAnimationFrame = saved.caf;
    });
    const t = setup({ schedule: 'frame' });
    await t.connection.idle();
    // The first frames apply what the initial render held for them.
    const frame = () => {
      const list = frames.splice(0);
      for (const fn of list) if (fn !== null) fn(performance.now());
    };
    frame();
    await t.connection.idle();
    frame();
    const messages = t.connection.totals.messages;
    t.port.hold = true;
    const bell = t.port.bell();
    t.remote.querySelector('button').click();
    // The worker answers into the mailbox, then rings; its bell is held back.
    await bell;
    assert.ok(t.connection.box.waiting() >= 0, 'the answer is in the mailbox');
    assert.ok(t.port.held.length > 0, 'its bell has not been read');
    assert.equal(t.remote.querySelector('button').textContent, 'n0');
    frame();
    assert.equal(t.remote.querySelector('button').textContent, 'n1', 'applied in the frame');
    assert.equal(t.connection.totals.polled, 1);
    assert.ok(t.infos.at(-1).framed && t.infos.at(-1).urgent);
    // The bell then finds the message taken: nothing applies twice.
    t.port.release();
    await t.connection.idle();
    frame();
    assert.equal(t.connection.totals.messages, messages + 1);
    t.direct.querySelector('button').click();
    assert.equal(t.remote.innerHTML, t.direct.innerHTML);
  });
});
