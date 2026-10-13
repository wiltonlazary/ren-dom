// Flow control: Sequence (the order Pendings show in), Times (rows
// by count), For keying modes.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write, $task, $context, $lookup, $memo, $flush } from 'rrx-core';
import { Pending, Sequence, Times, For } from 'ren-core';
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
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  return { container };
};

/** Three Pendings over three tasks under a Sequence; `done[i](value)` completes one. */
function three(/** @type {any} */ props) {
  const { container } = setup();
  const root = $root('app');
  /** @type {((value: string) => void)[]} */
  const done = [];
  const tasks = [0, 1, 2].map(i => $task(root, () => i, (_, complete) => void (done[i] = value => complete({ ok: true, value }))));
  render(() => (
    <Sequence {...props}>
      {tasks.map((t, i) => (
        <Pending fallback={<i>{`wait${i}`}</i>}>
          <b>{() => $read(t)}</b>
        </Pending>
      ))}
    </Sequence>
  ), container, { root });
  return { container, done };
}

describe('ren dom Sequence', () => {
  it('shows in order by default: a later ready Pending waits for the earlier ones', () => {
    const { container, done } = three({});
    assert.equal(container.innerHTML, '<i>wait0</i><i>wait1</i><i>wait2</i>');
    done[1]('b');
    assert.equal(container.innerHTML, '<i>wait0</i><i>wait1</i><i>wait2</i>', 'the second waits for the first');
    done[0]('a');
    assert.equal(container.innerHTML, '<b>a</b><b>b</b><i>wait2</i>');
    done[2]('c');
    assert.equal(container.innerHTML, '<b>a</b><b>b</b><b>c</b>');
  });

  it('shows only the next fallback with nextOnly', () => {
    const { container, done } = three({ nextOnly: true });
    assert.equal(container.innerHTML, '<i>wait0</i>');
    done[0]('a');
    assert.equal(container.innerHTML, '<b>a</b><i>wait1</i>');
  });

  it('shows all at once, or each as ready', () => {
    const atOnce = three({ order: 'at-once' });
    atOnce.done[0]('a');
    atOnce.done[2]('c');
    assert.equal(atOnce.container.innerHTML, '<i>wait0</i><i>wait1</i><i>wait2</i>');
    atOnce.done[1]('b');
    assert.equal(atOnce.container.innerHTML, '<b>a</b><b>b</b><b>c</b>');
    const asReady = three({ order: 'as-ready' });
    asReady.done[2]('c');
    assert.equal(asReady.container.innerHTML, '<i>wait0</i><i>wait1</i><b>c</b>');
    assert.throws(() => three({ order: 'sequential' }), /REN: unknown Sequence order "sequential"/, 'only the own order words');
  });
});

describe('ren dom Times and For keying', () => {
  it('renders by count, adding and removing at the end', () => {
    const { container } = setup();
    const root = $root('app');
    const n = $signal(root, 2);
    let built = 0;
    render(() => (
      <ul>
        <Times count={n} fallback={<li>none</li>}>{i => (built++, <li>{`row ${i}`}</li>)}</Times>
      </ul>
    ), container, { root });
    assert.equal(container.innerHTML, '<ul><li>row 0</li><li>row 1</li></ul>');
    $write(n, 4);
    assert.equal(container.innerHTML, '<ul><li>row 0</li><li>row 1</li><li>row 2</li><li>row 3</li></ul>');
    assert.equal(built, 4, 'the kept rows are not built again');
    $write(n, 1);
    assert.equal(container.innerHTML, '<ul><li>row 0</li></ul>');
    $write(n, 0);
    assert.equal(container.innerHTML, '<ul><li>none</li></ul>');
  });

  it('keys For by a function, or by position with by="position"', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    /** @type {string[]} */
    const builds = [];
    render(() => (
      <div>
        <p><For each={items} by={(/** @type {any} */ x) => x.id}>{item => (builds.push(`k${item().id}`), <b>{() => item().name}</b>)}</For></p>
        <p><For each={items} by="position">{item => (builds.push('i'), <i>{() => item().name}</i>)}</For></p>
      </div>
    ), container, { root });
    builds.length = 0;
    $write(items, [{ id: 2, name: 'B' }, { id: 1, name: 'A' }]);
    assert.equal(container.innerHTML, '<div><p><b>B</b><b>A</b></p><p><i>B</i><i>A</i></p></div>');
    assert.deepEqual(builds, [], 'keyed rows moved, positional rows took the new items');
  });

  it('reads contexts where the list was made each time its items run again', () => {
    const window = new Window();
    const div = window.document.createElement('div');
    const R = $root('app');
    const Ctx = $context('fallback');
    const v = $signal(R, 'one');
    const m = $memo(R, () => $read(v));
    render(() => <Ctx value={m}><p title={() => $lookup(Ctx)}><For each={() => [$lookup(Ctx)]}>{x => <b>{x()}</b>}</For></p></Ctx>, div, { root: R });
    assert.equal(div.innerHTML, '<p title="one"><b>one</b></p>');
    $write(v, 'two');
    $flush(R);
    assert.equal(div.innerHTML, '<p title="two"><b>two</b></p>', 'the provider, not the fallback');
  });
});
