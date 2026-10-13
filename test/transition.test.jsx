// No tearing on the DOM (the graph holds a consistent state while
// async work runs; stale content stays visible; `$pending` tells a change is
// coming).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write, $memo, $pending, $task } from 'rrx-core';
import { Pending, For, $active, Root, Recover, Label, $settle } from 'ren-core';
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
/** A Label's inline box-model defaults (ren-core's style.js). */
const LABEL = 'box-sizing: border-box; position: relative; display: block; white-space: pre;';

/** An async memo per key: `answer(key, value)` completes its fetch. */
function fetcher(/** @type {any} */ root, /** @type {any} */ key) {
  /** @type {Map<any, (value: any) => void>} */
  const answers = new Map();
  const data = $memo(root, () => {
    const k = $read(key);
    return new Promise(ok => answers.set(k, ok));
  });
  const answer = async (/** @type {any} */ k, /** @type {any} */ value) => {
    /** @type {(value: any) => void} */ (answers.get(k))(value);
    await $settle(root);
  };
  return { data, answer };
}

describe('ren dom transitions', () => {
  it('keeps the old content whole while a new answer is in flight; the indicator shows at once', async () => {
    const { container } = setup();
    const root = $root('app');
    const id = $signal(root, 1);
    const { data: user, answer } = fetcher(root, id);
    render(() => (
      <Pending fallback={<i>loading</i>}>
        <h1 data-stale={() => String($pending(user))}>{() => $read(user).name}</h1>
        <p>{() => `id ${$read(id)}`}</p>
      </Pending>
    ), container, { root });
    assert.equal(container.innerHTML, '<i>loading</i>');
    await answer(1, { name: 'ada' });
    assert.equal(container.innerHTML, '<h1 data-stale="false">ada</h1><p>id 1</p>');
    $write(id, 2);
    assert.equal(container.innerHTML, '<h1 data-stale="true">ada</h1><p>id 1</p>', 'no tearing: the id waits for its user');
    await answer(2, { name: 'grace' });
    assert.equal(container.innerHTML, '<h1 data-stale="false">grace</h1><p>id 2</p>');
  });

  it('keeps the old branch while the new one loads for the first time, and holds the rest of the update', async () => {
    const { container } = setup();
    const root = $root('app');
    const tab = $signal(root, 'a');
    /** @type {((value: any) => void)[]} */
    const loads = [];
    function B() {
      const data = $memo($active(), () => new Promise(ok => loads.push(ok)));
      return <section>B:{() => $read(data)}</section>;
    }
    render(() => (
      <Pending fallback={<i>loading</i>}>
        <nav data-tab={tab} />
        {() => ($read(tab) === 'a' ? <section>A</section> : <B />)}
      </Pending>
    ), container, { root });
    assert.equal(container.innerHTML, '<nav data-tab="a"></nav><section>A</section>');
    $write(tab, 'b');
    assert.equal(container.innerHTML, '<nav data-tab="a"></nav><section>A</section>', 'stale content stays visible');
    loads[0]('ready');
    await $settle(root);
    assert.equal(container.innerHTML, '<nav data-tab="b"></nav><section>B:ready</section>');
  });

  it('shows a new inner Pending at once: its own fallback, not the hold', () => {
    const { container } = setup();
    const root = $root('app');
    const tab = $signal(root, 'a');
    function B() {
      const data = $memo($active(), () => new Promise(() => {}));
      return <section>{() => $read(data)}</section>;
    }
    render(() => (
      <Pending fallback={<i>outer</i>}>
        {() => ($read(tab) === 'a' ? <section>A</section> : <Pending fallback={<i>inner</i>}><B /></Pending>)}
      </Pending>
    ), container, { root });
    $write(tab, 'b');
    assert.equal(container.innerHTML, '<i>inner</i>');
  });

  it('shows the fallback again on a key change with Pending again', async () => {
    const { container } = setup();
    const root = $root('app');
    const id = $signal(root, 1);
    const { data: user, answer } = fetcher(root, id);
    render(() => (
      <Pending again={() => $read(id)} fallback={<i>loading</i>}>
        <h1>{() => $read(user).name}</h1>
      </Pending>
    ), container, { root });
    await answer(1, { name: 'ada' });
    assert.equal(container.innerHTML, '<h1>ada</h1>');
    $write(id, 2);
    assert.equal(container.innerHTML, '<i>loading</i>', 'the key changed: the fallback, not the stale content');
    await answer(2, { name: 'grace' });
    assert.equal(container.innerHTML, '<h1>grace</h1>');
  });

  it('holds a list and its siblings while its items revalidate', () => {
    const { container } = setup();
    const root = $root('app');
    const query = $signal(root, 'a');
    /** @type {((r: any) => void)[]} */
    const done = [];
    const words = $task(root, () => $read(query), (_, complete) => void done.push(complete));
    render(() => (
      <Pending fallback={<i>loading</i>}>
        <p>{() => `query ${$read(query)}`}</p>
        <ul><For each={() => $read(words)}>{word => <li>{word}</li>}</For></ul>
      </Pending>
    ), container, { root });
    done[0]({ ok: true, value: ['apple'] });
    assert.equal(container.innerHTML, '<p>query a</p><ul><li>apple</li></ul>');
    $write(query, 'b');
    assert.equal(container.innerHTML, '<p>query a</p><ul><li>apple</li></ul>');
    done[1]({ ok: true, value: ['banana', 'berry'] });
    assert.equal(container.innerHTML, '<p>query b</p><ul><li>banana</li><li>berry</li></ul>');
  });

  it('keeps the old content live while it waits: its handlers run and its unrelated updates apply', () => {
    const { container } = setup();
    const root = $root('app');
    const tab = $signal(root, 'a');
    const clicks = $signal(root, 0);
    function B() {
      const data = $memo($active(), () => new Promise(() => {}));
      return <section>{() => $read(data)}</section>;
    }
    render(() => (
      <Pending fallback={<i>loading</i>}>
        {() => ($read(tab) === 'a' ? <button onClick={() => $write(clicks, $read(clicks) + 1)}>{clicks}</button> : <B />)}
      </Pending>
    ), container, { root });
    $write(tab, 'b');
    const button = /** @type {any} */ (container.querySelector('button'));
    button.click();
    assert.equal(container.innerHTML, '<button>1</button>');
  });

  it('hands the id of a nested root from the content being replaced to the new content', () => {
    const { container } = setup();
    const root = $root('app');
    const tab = $signal(root, 'a');
    render(() => (
      <div>
        {() => ($read(tab) === 'a' ? <Root id="side">{() => <b>a</b>}</Root> : <Root id="side">{() => <i>b</i>}</Root>)}
      </div>
    ), container, { root });
    assert.match(container.innerHTML, /<b>a<\/b>/);
    $write(tab, 'b');
    assert.match(container.innerHTML, /<i>b<\/i>/);
    assert.doesNotMatch(container.innerHTML, /<b>a<\/b>/);
  });

  it('ends the hold when the revalidation fails: Recover shows, a region indicator shows at once', () => {
    const { container } = setup();
    const root = $root('app');
    const id = $signal(root, 1);
    /** @type {((r: any) => void)[]} */
    const done = [];
    const user = $task(root, () => $read(id), (_, complete) => void done.push(complete));
    render(() => (
      <div>
        <Recover fallback={(/** @type {Error} */ e) => <p>failed: {e.message}</p>}>
          <Pending fallback={<i>loading</i>}>
            <Label text={() => `user ${$read(user)}`} />
          </Pending>
        </Recover>
        <s>{() => String($pending(user))}</s>
      </div>
    ), container, { root });
    done[0]({ ok: true, value: 'ada' });
    assert.equal(container.innerHTML, `<div><span data-ren="Label" style="${LABEL}">user ada</span><s>false</s></div>`);
    $write(id, 13);
    assert.equal(container.innerHTML, `<div><span data-ren="Label" style="${LABEL}">user ada</span><s>true</s></div>`);
    done[1]({ ok: false, error: new Error('unlucky') });
    assert.equal(container.innerHTML, '<div><p>failed: unlucky</p><s>false</s></div>');
  });
});
