// The DOM renderer with JSX (compiled by test/loader.mjs), on happy-dom.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Window as HappyWindow } from 'happy-dom';
import { $root, $signal, $read, $write, $memo, $flush, $stats, $cleanup, $owner, $task, $batch, $auto, $catch } from 'rrx-core';
import { Show, For, Choose, When, Portal, Pending, Recover, Render, $active, $parts, View, Layout, Label, Edit, Action } from 'ren-core';
import { mount } from 'ren-core/host';
import { jsx } from 'ren-core/jsx-runtime';
import { render, $dom } from 'ren-dom';

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

describe('ren dom', () => {
  it('renders static JSX, fragments, components and text', () => {
    const { container } = setup();
    const Greeting = props => <p class="greet">Hello {props.name}</p>;
    const dispose = render(() => (
      <>
        <Greeting name="Ada" />
        <span>{1}{' '}{true}{null}{false}</span>
      </>
    ), container);
    assert.equal(container.innerHTML, '<p class="greet">Hello Ada</p><span>1 </span>');
    dispose();
    assert.equal(container.innerHTML, '');
  });

  it('chooses the option a select\'s value names, though the options come after the value', () => {
    // ren-core sets props before it inserts children: the select was empty when its value was set.
    const { container } = setup();
    const dispose = render(() => (
      <select value="b">
        <option value="a">A</option>
        <optgroup label="more">
          <option value="b">B</option>
        </optgroup>
      </select>
    ), container);
    assert.equal(container.querySelector('select').value, 'b');
    dispose();
    // An empty value names an option too: the one whose value is "" (none selected is a select's "" as well).
    const empty = render(() => (
      <select value="">
        <option value="a">A</option>
        <option value="">None</option>
      </select>
    ), container);
    const select = /** @type {any} */ (container.querySelector('select'));
    assert.deepEqual([select.selectedIndex, select.value], [1, ''], 'the None option, as a browser chooses it');
    empty();
  });

  it('keeps a select\'s value for an option to come, as a browser keeps its choice, until the user picks one', () => {
    const { window, container } = setup();
    for (const kept of ['', 'z'])
      for (const event of ['change', 'input']) {
        const root = $root('app');
        const list = $signal(root, ['a', 'b']);
        const value = $signal(root, kept);
        const dispose = render(() => (
          <select value={() => $read(value)}>
            <For each={list}>{x => <option value={x}>{x}</option>}</For>
          </select>
        ), container, { root });
        const select = /** @type {any} */ (container.querySelector('select'));
        const at = (/** @type {string} */ what) => `${JSON.stringify(kept)} ${event}: ${what}`;
        assert.deepEqual([select.value, select.selectedIndex], ['a', 0], at('no option holds it: the first, as a browser chooses'));
        $write(list, ['a', 'b', 'c']);
        assert.deepEqual([select.value, select.selectedIndex], ['a', 0], at('an option coming in keeps the choice, as at mount'));
        $write(list, ['a', 'b', 'c', kept]);
        assert.deepEqual([select.value, select.selectedIndex], [kept, 3], at('the option that holds it comes: chosen'));
        // Unmatched again while its options are there: none, as a browser's select.value; then the user picks.
        $write(value, 'q');
        assert.deepEqual([select.value, select.selectedIndex], ['', -1], at('none holds it'));
        select.value = 'b';
        select.dispatchEvent(new window.Event(event, { bubbles: true }));
        $write(list, ['a', 'b', 'c', kept, 'q']);
        assert.deepEqual([select.value, select.selectedIndex], ['b', 1], at('the user\'s pick holds over an option naming the old value'));
        dispose();
      }
  });

  it('empties a control given a null or undefined value, never the text "undefined"', () => {
    const { container } = setup();
    const root = $root('app');
    const value = $signal(root, /** @type {string | null | undefined} */ ('a'));
    /** @type {any[]} */ const els = [];
    render(() => (
      <form>
        <input ref={el => els.push(el)} value={() => $read(value)} />
        <textarea ref={el => els.push(el)} value={() => $read(value)} />
        <output ref={el => els.push(el)} value={() => $read(value)} />
        <select ref={el => els.push(el)} value={() => $read(value)}>
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
      </form>
    ), container, { root });
    assert.deepEqual(els.map(el => el.value), ['a', 'a', 'a', 'a']);
    for (const empty of [undefined, null]) {
      const chosen = els[3].value;
      $write(value, empty);
      assert.deepEqual(els.slice(0, 3).map(el => el.value), ['', '', ''], String(empty));
      assert.equal(els[3].value, chosen, 'a select keeps its choice, as it is not assigned');
      $write(value, 'b');
      assert.deepEqual(els.map(el => el.value), ['b', 'b', 'b', 'b']);
    }
    /** @type {any} */ let first = null;
    const once = render(() => <input ref={el => (first = el)} value={undefined} />, container);
    assert.equal(first.value, '', 'a first value of undefined too');
    once();
    // A checkbox's and a submit's value is their attribute: without one, "on" and the default label,
    // with the type given before the value or after it.
    for (const empty of [undefined, null]) {
      /** @type {any[]} */ const inputs = [];
      const both = render(() => (
        <form>
          <input ref={el => inputs.push(el)} type="checkbox" value={empty} />
          <input ref={el => inputs.push(el)} value={empty} type="checkbox" />
          <input ref={el => inputs.push(el)} type="submit" value={empty} />
          <input ref={el => inputs.push(el)} value={empty} type="submit" />
        </form>
      ), container);
      assert.deepEqual(inputs.map(el => [el.type, el.value, el.getAttribute('value')]), [
        ['checkbox', 'on', null],
        ['checkbox', 'on', null],
        ['submit', '', null],
        ['submit', '', null],
      ], String(empty));
      both();
    }
    const checked = $signal(root, /** @type {string | null | undefined} */ ('yes'));
    /** @type {any} */ let box = null;
    render(() => <input ref={el => (box = el)} type="checkbox" value={() => $read(checked)} />, container, { root });
    assert.equal(box.value, 'yes');
    for (const empty of [undefined, null]) {
      $write(checked, empty);
      assert.deepEqual([box.value, box.getAttribute('value')], ['on', null], `a checkbox's value going to ${empty}`);
      $write(checked, 'yes');
    }
  });

  it('removes a token list attribute given null or undefined, never writing "null": sandbox, relList, an output\'s htmlFor', () => {
    const { container } = setup();
    const root = $root('app');
    const given = $signal(root, /** @type {string | null | undefined} */ ('allow-scripts'));
    /** @type {any[]} */ const els = [];
    render(() => (
      <div>
        <iframe ref={el => els.push(el)} sandbox={null} />
        <a ref={el => els.push(el)} relList={undefined} />
        <output ref={el => els.push(el)} htmlFor={null} />
        <iframe ref={el => els.push(el)} sandbox={() => $read(given)} />
        <a ref={el => els.push(el)} relList={() => $read(given)} />
        <output ref={el => els.push(el)} htmlFor={() => $read(given)} />
      </div>
    ), container, { root });
    const attributes = () => els.map((el, i) => el.getAttribute(['sandbox', 'rel', 'for'][i % 3]));
    assert.deepEqual(attributes(), [null, null, null, 'allow-scripts', 'allow-scripts', 'allow-scripts'], 'static null or undefined writes nothing');
    for (const empty of [null, undefined]) {
      $write(given, empty);
      assert.deepEqual(attributes().slice(3), [null, null, null], `going to ${empty}`);
      $write(given, 'allow-scripts');
    }
  });

  it('removes the attribute an ARIA property or classList reflects when it goes to null or undefined', () => {
    const { window, container } = setup();
    // A browser's ARIA reflection (happy-dom has none): ariaLabel is the aria-label attribute.
    for (const [name, attribute] of [['ariaLabel', 'aria-label'], ['ariaDescription', 'aria-description']])
      Object.defineProperty(window.HTMLElement.prototype, name, {
        configurable: true,
        get() {
          return this.getAttribute(attribute);
        },
        set(/** @type {any} */ value) {
          if (value === null) this.removeAttribute(attribute);
          else this.setAttribute(attribute, String(value));
        },
      });
    const root = $root('app');
    const given = $signal(root, /** @type {string | null | undefined} */ ('a b'));
    /** @type {any[]} */ const els = [];
    render(() => (
      <div>
        <div ref={el => els.push(el)} ariaLabel={() => $read(given)} />
        <div ref={el => els.push(el)} ariaDescription={() => $read(given)} />
        <div ref={el => els.push(el)} classList={() => $read(given)} />
      </div>
    ), container, { root });
    const read = () => [els[0].getAttribute('aria-label'), els[1].getAttribute('aria-description'), els[2].getAttribute('class')];
    assert.deepEqual(read(), ['a b', 'a b', 'a b']);
    for (const empty of [null, undefined]) {
      $write(given, empty);
      assert.deepEqual(read(), [null, null, null], `going to ${empty}`);
      assert.deepEqual(els.map(el => [...el.attributes].map((/** @type {any} */ a) => a.name)), [[], [], []], 'no other attribute left or made');
      $write(given, 'a b');
    }
  });

  it('writes download={true} as an empty attribute, as ren-html does, and removes it on false', () => {
    const { container } = setup();
    const root = $root('app');
    const on = $signal(root, /** @type {boolean | string} */ (true));
    const dispose = render(() => <a href="/f" download={() => $read(on)}>f</a>, container, { root });
    assert.equal(container.innerHTML, '<a href="/f" download="">f</a>');
    $write(on, 'report.txt');
    assert.equal(container.innerHTML, '<a href="/f" download="report.txt">f</a>');
    $write(on, false);
    assert.equal(container.innerHTML, '<a href="/f">f</a>');
    dispose();
  });

  it('writes a number in px but for the unitless properties', () => {
    const { container } = setup();
    let d = null;
    render(() => <div ref={el => (d = el)} style={{ borderRadius: 4, borderWidth: 2, lineHeight: 1.5, width: 10, opacity: 0.5, zIndex: 2, flexGrow: 1, order: 3 }}>y</div>, container);
    assert.equal(d.style.borderRadius, '4px');
    assert.equal(d.style.borderWidth, '2px');
    assert.equal(d.style.lineHeight, '1.5');
    assert.equal(d.style.width, '10px');
    assert.equal(d.style.opacity, '0.5');
    assert.equal(d.style.zIndex, '2');
    assert.equal(d.style.flexGrow, '1');
    assert.equal(d.style.order, '3');
  });

  it('removes a style key the view drops, camelCase or kebab-case', () => {
    const { container } = setup();
    const root = $root('app');
    const on = $signal(root, true);
    let p = null;
    render(() => (
      <p ref={el => (p = el)} style={() => ($read(on) ? { backgroundColor: 'red', 'margin-top': '2px', color: 'blue' } : { color: 'blue' })}>x</p>
    ), container, { root });
    assert.equal(p.getAttribute('style'), 'background-color: red; margin-top: 2px; color: blue;');
    $write(on, false);
    assert.equal(p.getAttribute('style'), 'color: blue;');
  });

  it('binds reactive attributes, styles and text in place', () => {
    const { container } = setup();
    const root = $root('app');
    const count = $signal(root, 1);
    const name = $signal(root, 'a');
    let paragraph = null;
    render(() => (
      <p ref={el => (paragraph = el)} title={() => `n${$read(count)}`} class={name} style={() => ({ color: $read(count) > 1 ? 'red' : 'blue' })}>
        {() => $read(count)}!
      </p>
    ), container, { root });
    const text = paragraph.firstChild;
    assert.equal(container.innerHTML, '<p title="n1" class="a" style="color: blue;">1!</p>');
    $write(count, 2);
    $write(name, 'b');
    assert.equal(container.innerHTML, '<p title="n2" class="b" style="color: red;">2!</p>');
    assert.equal(paragraph.firstChild, text, 'text updates in place');
  });

  it('batches event handlers into one flush', () => {
    const { container } = setup();
    const root = $root('app');
    const a = $signal(root, 0);
    const b = $signal(root, 0);
    let runs = 0;
    const sum = $memo(root, () => {
      runs++;
      return $read(a) + $read(b);
    });
    render(() => (
      <button onClick={() => {
        $write(a, $read(a) + 1);
        $write(b, $read(b) + 1);
      }}>{sum}</button>
    ), container, { root });
    container.querySelector('button').click();
    assert.equal(container.textContent, '2');
    assert.equal(runs, 2, 'one recompute for two writes in one handler');
  });

  it('switches Show branches only when truthiness changes and cleans up', () => {
    const { container } = setup();
    const root = $root('app');
    const n = $signal(root, 1);
    let built = 0;
    let cleaned = 0;
    const Panel = props => {
      built++;
      $cleanup($owner($active()), () => cleaned++);
      return <b>{() => props.value()}</b>;
    };
    render(() => (
      <Show when={() => $read(n) > 0} fallback={<i>none</i>}>
        {value => <Panel value={() => (value() ? $read(n) : 0)} />}
      </Show>
    ), container, { root });
    assert.equal(container.innerHTML, '<b>1</b>');
    $write(n, 2);
    assert.equal(container.innerHTML, '<b>2</b>');
    assert.equal(built, 1, 'the branch is kept while truthiness holds');
    $write(n, 0);
    assert.equal(container.innerHTML, '<i>none</i>');
    assert.equal(cleaned, 1);
    $write(n, 3);
    assert.equal(container.innerHTML, '<b>3</b>');
    assert.equal(built, 2);
  });

  it('keeps keyed rows with For and moves them', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }]);
    let built = 0;
    render(() => (
      <ul>
        <For each={items} by={item => item.id} fallback={<li>empty</li>}>
          {(item, index) => {
            built++;
            return <li>{() => `${index()}${item().t}`}</li>;
          }}
        </For>
      </ul>
    ), container, { root });
    const ul = container.firstChild;
    const [a, b, c] = [...ul.children];
    assert.equal(ul.innerHTML, '<li>0a</li><li>1b</li><li>2c</li>');
    $write(items, [{ id: 3, t: 'C' }, { id: 1, t: 'a' }, { id: 2, t: 'b' }]);
    assert.equal(ul.innerHTML, '<li>0C</li><li>1a</li><li>2b</li>');
    const moved = [...ul.children];
    assert.ok(moved[0] === c && moved[1] === a && moved[2] === b, 'rows move, not rebuild');
    assert.equal(built, 3);
    $write(items, [{ id: 2, t: 'b' }]);
    assert.equal(ul.innerHTML, '<li>0b</li>');
    $write(items, []);
    assert.equal(ul.innerHTML, '<li>empty</li>');
    $write(items, [{ id: 9, t: 'z' }]);
    assert.equal(ul.innerHTML, '<li>0z</li>');
  });

  it('keeps positional rows with For by position', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, ['x', 'y']);
    render(() => <ol><For by="position" each={items}>{(item, i) => <li>{i}:{item}</li>}</For></ol>, container, { root });
    const first = container.querySelector('li');
    $write(items, ['z', 'y', 'w']);
    assert.equal(container.innerHTML, '<ol><li>0:z</li><li>1:y</li><li>2:w</li></ol>');
    assert.equal(container.querySelector('li'), first);
  });

  it('chooses with Choose and When, and Render components', () => {
    const { container } = setup();
    const root = $root('app');
    const n = $signal(root, 1);
    const which = $signal(root, 'b');
    const A = () => <em>A</em>;
    const components = { a: A, b: () => <strong>B</strong> };
    render(() => (
      <div>
        <Choose fallback={<span>other</span>}>
          <When when={() => $read(n) === 1}>one</When>
          <When when={() => $read(n) === 2}>two</When>
        </Choose>
        <Render of={() => components[$read(which)]} />
      </div>
    ), container, { root });
    assert.equal(container.innerHTML, '<div>one<strong>B</strong></div>');
    $write(n, 2);
    $write(which, 'a');
    assert.equal(container.innerHTML, '<div>two<em>A</em></div>');
    $write(n, 5);
    assert.equal(container.innerHTML, '<div><span>other</span><em>A</em></div>');
  });

  it('renders portals into another container and closes them', () => {
    const { container, document } = setup();
    const root = $root('app');
    const open = $signal(root, true);
    const layer = document.createElement('section');
    document.body.appendChild(layer);
    render(() => <div><Show when={open}><Portal into={layer}><p>overlay</p></Portal></Show></div>, container, { root });
    assert.equal(layer.innerHTML, '<p>overlay</p>');
    $write(open, false);
    assert.equal(layer.innerHTML, '');
  });

  it('shows Pending until pending reads resolve, then keeps content', () => {
    const { container } = setup();
    const root = $root('app');
    const query = $signal(root, 1);
    const replies = [];
    const task = $task(root, () => $read(query), (input, complete) => {
      replies.push(complete);
    });
    render(() => <Pending fallback={<i>loading</i>}><b>{() => $read(task)}</b></Pending>, container, { root });
    assert.equal(container.innerHTML, '<i>loading</i>');
    replies[0]({ ok: true, value: 'ready' });
    $flush(root);
    assert.equal(container.innerHTML, '<b>ready</b>');
    $write(query, 2);
    assert.equal(container.innerHTML, '<b>ready</b>', 'a refresh keeps the content');
    replies[1]({ ok: true, value: 'again' });
    $flush(root);
    assert.equal(container.innerHTML, '<b>again</b>');
  });

  it('shows content that became ready while Pending held it detached', async () => {
    const { container } = setup();
    const root = $root('app');
    const replies = [];
    const task = $task(root, () => 1, (input, complete) => {
      replies.push(complete);
    });
    const inner = $task(root, () => 1, (input, complete) => {
      replies.push(complete);
    });
    render(() => (
      <div>
        <Pending fallback={<i>outer</i>}>
          {() => <b>{String($read(task))}</b>}
          <For each={() => $read(task)}>{x => <s>{x}</s>}</For>
          <Pending fallback={<i>inner</i>}>{() => <u>{String($read(inner))}</u>}</Pending>
        </Pending>
      </div>
    ), container, { root });
    assert.equal(container.innerHTML, '<div><i>outer</i></div>');
    // Completions arrive later, as a promise's would.
    await Promise.resolve();
    replies[0]({ ok: true, value: [7] });
    $flush(root);
    assert.equal(container.innerHTML, '<div><b>7</b><s>7</s><i>inner</i></div>');
    replies[1]({ ok: true, value: 'deep' });
    $flush(root);
    assert.equal(container.innerHTML, '<div><b>7</b><s>7</s><u>deep</u></div>');
  });

  it('holds Pending while a list reads a pending task, owned or between siblings', () => {
    const { container } = setup();
    const root = $root('app');
    const query = $signal(root, 1);
    const replies = [];
    const task = $task(root, () => $read(query), (input, complete) => {
      replies.push(complete);
    });
    render(() => (
      <Pending fallback={<i>loading</i>}>
        <ul><For each={() => $read(task)} fallback={<li>none</li>}>{word => <li>{word}</li>}</For></ul>
        <p>before<For by="position" each={() => $read(task)}>{word => <b>{word}</b>}</For>after</p>
      </Pending>
    ), container, { root });
    assert.equal(container.innerHTML, '<i>loading</i>');
    replies[0]({ ok: true, value: ['a', 'b'] });
    $flush(root);
    assert.equal(container.innerHTML, '<ul><li>a</li><li>b</li></ul><p>before<b>a</b><b>b</b>after</p>');
    $write(query, 2);
    assert.equal(container.innerHTML, '<ul><li>a</li><li>b</li></ul><p>before<b>a</b><b>b</b>after</p>', 'a refresh keeps the rows');
    replies[1]({ ok: true, value: [] });
    $flush(root);
    assert.equal(container.innerHTML, '<ul><li>none</li></ul><p>beforeafter</p>');
  });

  it('completes the view update when a cleanup of the old content throws', () => {
    const { container } = setup();
    const root = $root('app');
    const caught = [];
    $catch(root, error => caught.push(error.message));
    const on = $signal(root, true);
    const items = $signal(root, [1]);
    const Fragile = props => {
      $cleanup($owner($active()), () => {
        throw new Error(`cleanup ${props.name}`);
      });
      return <b>{props.name}</b>;
    };
    render(() => (
      <div>
        <Show when={on} fallback={<i>off</i>}><Fragile name="branch" /></Show>
        <ul><For each={items} fallback={<li>empty</li>}>{() => <li>row</li>}</For></ul>
        <p>{() => ($read(on) ? <Fragile name="region" /> : 'plain')}</p>
      </div>
    ), container, { root });
    $write(on, false);
    assert.equal(container.innerHTML, '<div><i>off</i><ul><li>row</li></ul><p>plain</p></div>');
    assert.deepEqual(caught.sort(), ['cleanup branch', 'cleanup region']);
    $write(items, []);
    $write(items, [2]);
    assert.equal(container.querySelector('ul').innerHTML, '<li>row</li>', 'the list still reconciles');
  });

  it('shows Recover fallbacks and resets', () => {
    const { container } = setup();
    const root = $root('app');
    const n = $signal(root, 1);
    const Risky = () => <b>{() => {
      if ($read(n) < 0) throw new Error('negative');
      return $read(n);
    }}</b>;
    render(() => (
      <Recover fallback={(error, reset) => <button onClick={() => {
        $write(n, 1);
        reset();
      }}>{error.message}</button>}>
        <Risky />
      </Recover>
    ), container, { root });
    assert.equal(container.innerHTML, '<b>1</b>');
    $write(n, -1);
    assert.equal(container.innerHTML, '<button>negative</button>');
    container.querySelector('button').click();
    assert.equal(container.innerHTML, '<b>1</b>');
  });

  it('maps ren-core primitives to DOM with portable events', () => {
    const { container } = setup();
    const root = $root('app');
    const value = $signal(root, 'hi');
    const presses = [];
    render(() => (
      <View gap={8} pad={4}>
        <Layout layout="row" fill={0xff336699}>
          <Label text={value} size={13} />
          <Edit label="Name" value={value} onChange={e => $write(value, e.value)} />
          <Action text="Go" onPress={() => presses.push($read(value))} />
          <Edit lines={3} value="multi" />
        </Layout>
      </View>
    ), container, { root });
    const view = container.firstChild;
    assert.equal(view.getAttribute('data-ren'), 'View');
    assert.equal(view.style.gap, '8px');
    const input = container.querySelector('input');
    assert.equal(input.value, 'hi');
    assert.equal(input.placeholder, 'Name');
    input.value = 'yo';
    // Delegated handlers see bubbling events, as the browser's input events are.
    input.dispatchEvent(new container.ownerDocument.defaultView.Event('input', { bubbles: true }));
    assert.equal(container.querySelector('span').textContent, 'yo');
    container.querySelector('button').click();
    assert.deepEqual(presses, ['yo']);
    assert.equal(container.querySelector('textarea').value, 'multi');
    assert.equal(container.querySelector('[data-ren=Layout]').style.flexDirection, 'row');
  });

  it('disposes every binding with the view', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, [1, 2, 3]);
    const before = $stats(root).nodes;
    const dispose = render(() => <div><For each={items}>{item => <i title={() => String(item())}>{item}</i>}</For></div>, container, { root });
    $write(items, [3, 4]);
    dispose();
    assert.equal(container.innerHTML, '');
    assert.equal($stats(root).nodes, before, 'no node outlives the view');
    assert.equal($stats(root).effects, 0);
  });

  it('lets the nodes of removed initial rows and regions be collected', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc');
    // A plain-object host: happy-dom keeps nodes of its own.
    const tree = () => ({ parent: null, kids: [] });
    const host = {
      element: () => tree(),
      text: () => tree(),
      content() {},
      set() {},
      listen: () => () => {},
      insert(parent, child, before) {
        if (child.parent) host.remove(child.parent, child);
        const at = before === null ? parent.kids.length : parent.kids.indexOf(before);
        parent.kids.splice(at, 0, child);
        child.parent = parent;
      },
      remove(parent, child) {
        parent.kids.splice(parent.kids.indexOf(child), 1);
        child.parent = null;
      },
      marker: () => tree(),
      parent: node => node.parent,
      next: node => (node.parent === null ? null : node.parent.kids[node.parent.kids.indexOf(node) + 1] ?? null),
      owns: value => value != null && typeof value === 'object' && Array.isArray(value.kids),
      layer: () => tree(),
    };
    // Finalization reports each collected node; GC itself has no event to await.
    /** @type {Set<string>} */
    const freed = new Set();
    const registry = new FinalizationRegistry(/** @param {string} name */ name => freed.add(name));
    // Built in a plain function, so no suspended async frame holds a node.
    const build = () => {
      const container = tree();
      const root = $root('app');
      const items = $signal(root, [1, 2, 3]);
      const shown = $signal(root, true);
      // The refs hold weak references only: the For callback keeps this scope alive.
      const refs = [null, null];
      mount(host, () => (
        <div>
          <ul><For each={items}>{item => <li ref={node => (refs[0] ??= (registry.register(node, 'row'), new WeakRef(node)))}>{item}</li>}</For></ul>
          {() => ($read(shown) ? <b ref={node => (registry.register(node, 'bold'), refs[1] = new WeakRef(node))}>on</b> : null)}
        </div>
      ), container, { root });
      $write(items, []);
      $write(shown, false);
      return { refs, root };
    };
    const { refs: [row, bold], root } = build();
    // deref() keeps its target for the rest of the job, so the loop tests the
    // registry; a task turn lets the collection and its finalizers run.
    for (let i = 0; i < 20 && freed.size < 2; i++) {
      gc();
      await new Promise(resolve => setTimeout(resolve, 0)); // timer: poll
    }
    assert.ok(row.deref() === undefined, 'the list effect does not keep its first rows');
    assert.ok(bold.deref() === undefined, 'the region effect does not keep its first content');
  });

  it('flushes explicitly when Auto is off', () => {
    const { container } = setup();
    const root = $root('app');
    const n = $signal(root, 1);
    render(() => <b>{n}</b>, container, { root, auto: false });
    $write(n, 2);
    assert.equal(container.innerHTML, '<b>1</b>');
    $flush(root);
    assert.equal(container.innerHTML, '<b>2</b>');
    $batch(root, () => $write(n, 3));
    assert.equal(container.innerHTML, '<b>3</b>');
    $auto(root, true);
  });
  it('removes the attribute of a DOM property given null or undefined, as ren-html writes none', () => {
    const { container } = setup();
    render(() => <a id={null} title={undefined} href={null} tabIndex={undefined} download={null}>f</a>, container);
    assert.equal(container.innerHTML, '<a>f</a>', 'no "null", no "undefined", no tabindex 0');
    const root = $root('app');
    const s = $signal(root, /** @type {any} */ ('x'));
    const n = $signal(root, /** @type {any} */ (2));
    render(() => (
      <p>
        <a id={() => $read(s)} href={() => $read(s)} download={() => $read(s)} tabIndex={() => $read(n)}>g</a>
        <input value={() => $read(s)} />
      </p>
    ), container, { root });
    const link = /** @type {any} */ (container.querySelector('p a'));
    const input = /** @type {any} */ (container.querySelector('p input'));
    assert.equal(link.outerHTML, '<a id="x" href="x" download="x" tabindex="2">g</a>');
    $write(s, null);
    $write(n, undefined);
    assert.equal(link.outerHTML, '<a>g</a>', 'a reactive null removes each');
    assert.equal(input.value, '', 'value stays a property');
    $write(s, 'y');
    assert.equal(link.outerHTML, '<a id="y" href="y" download="y">g</a>');
  });

  it('writes a boolean aria-* or microdata content as "true" or "false"', () => {
    const { container } = setup();
    const root = $root('app');
    const open = $signal(root, false);
    render(() => (
      <div>
        <button aria-expanded={() => $read(open)} aria-hidden={true} data-on={true} draggable={false} />
        <View aria-checked={false} aria-selected={true} />
        <View itemprop="inStock" content={true} />
        <View itemprop="gift" content={false} />
      </div>
    ), container, { root });
    const button = /** @type {any} */ (container.querySelector('button'));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-hidden'), 'true');
    assert.equal(button.getAttribute('data-on'), '', 'other booleans keep HTML\'s rules');
    $write(open, true);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    const [checked, stocked, gift] = [...container.querySelectorAll('[data-ren="View"]')];
    assert.equal(checked.getAttribute('aria-checked'), 'false');
    assert.equal(checked.getAttribute('aria-selected'), 'true');
    assert.equal(stocked.getAttribute('content'), 'true');
    assert.equal(gift.getAttribute('content'), 'false');
  });
  it('clears defaultValue given null or undefined: an input\'s value attribute, a textarea\'s text', () => {
    const { container } = setup();
    const root = $root('app');
    const dv = $signal(root, /** @type {any} */ ('a'));
    render(() => (
      <p>
        <input defaultValue={() => $read(dv)} />
        <textarea defaultValue={() => $read(dv)} />
        <input defaultValue={null} />
      </p>
    ), container, { root });
    const [input, textarea, empty] = /** @type {any[]} */ ([...container.querySelectorAll('input, textarea')]);
    assert.equal(input.defaultValue, 'a');
    assert.equal(textarea.defaultValue, 'a');
    assert.equal(empty.defaultValue, '');
    $write(dv, null);
    assert.equal(input.defaultValue, '', 'the value attribute is cleared');
    assert.equal(textarea.defaultValue, '', 'the text is cleared');
    $write(dv, 'b');
    assert.equal(input.defaultValue, 'b');
    assert.equal(textarea.textContent, 'b');
  });

  it('makes each element in the namespace it stands in: SVG inside <svg>, HTML inside a foreignObject', () => {
    const { container } = setup();
    const root = $root('app');
    const on = $signal(root, false);
    const items = $signal(root, [1]);
    render(() => (
      <div>
        <svg viewBox="0 0 10 10">
          <Show when={on}><circle r={1} /><image href="a.png" /></Show>
          <For each={items}>{i => <g><rect width={i} /><marker id="m" /><title>t</title><a href="#x"><text>x</text></a></g>}</For>
          <filter><feGaussianBlur stdDeviation="2" /></filter>
          <style>{'rect { fill: red }'}</style>
          <foreignObject><div><a href="#h">h</a></div></foreignObject>
          <symbol id="s"><desc>d</desc></symbol>
          <animate attributeName="x" />
        </svg>
        <a href="#after">after</a>
        <title>page</title>
      </div>
    ), container, { root });
    $write(on, true);
    $write(items, [1, 2]);
    const ns = (/** @type {any} */ el) => (el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : 'html');
    const svg = /** @type {any} */ (container.querySelector('svg'));
    for (const el of svg.querySelectorAll('*')) {
      const inForeign = el.closest('foreignObject') !== null && el.localName !== 'foreignObject';
      assert.equal(ns(el), inForeign ? 'html' : 'svg', `<${el.localName}> ${inForeign ? 'inside a foreignObject' : 'inside <svg>'}`);
    }
    assert.equal(svg.querySelectorAll('g').length, 2, 'For rows inside the svg');
    assert.ok(svg.querySelector('circle') !== null && svg.querySelector('image') !== null, 'Show content inside the svg');
    const after = /** @type {any} */ ([...container.querySelectorAll('a')].find(a => a.getAttribute('href') === '#after'));
    assert.equal(ns(after), 'html', 'an <a> after the svg is HTML');
    assert.equal(ns(container.querySelector('div > title')), 'html');
    // An svg whose children are nothing leaves no namespace behind for the next sibling.
    const empty = setup().container;
    render(() => <div><svg>{false}</svg><svg>{[null, false]}</svg><a href="#n">n</a></div>, empty);
    assert.equal(ns(empty.querySelector('a')), 'html');
    // A component made of an SVG element alone, with no parent yet: by its name.
    const alone = setup().container;
    render(() => <circle r={2} />, alone);
    assert.equal(ns(alone.firstChild), 'svg');
  });
  it('gives a shared name the namespace of the element it is written inside, never one left behind', () => {
    const ns = (/** @type {any} */ el) => (el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : 'html');
    const Nothing = () => null;
    const Bad = () => {
      throw new Error('x');
    };
    const Link = (/** @type {any} */ p) => <a href="#t" class={p.c}><text>t</text></a>;
    /** Renders `view`, returning its container. @param {() => any} view */
    const shown = view => {
      const { container } = setup();
      render(view, container);
      return container;
    };
    // An svg whose children made nothing: the next sibling is HTML.
    assert.equal(ns(shown(() => <div><svg><Nothing /></svg><a href="#a">a</a></div>).querySelector('a')), 'html');
    assert.equal(ns(shown(() => <div><svg><Show when={false}><circle /></Show></svg><a href="#a">a</a></div>).querySelector('a')), 'html');
    assert.equal(ns(shown(() => <div><svg><For each={[]}>{() => <g />}</For></svg><a href="#a">a</a></div>).querySelector('a')), 'html');
    assert.equal(ns(shown(() => <div><svg><g><Nothing /></g><circle /></svg><title>x</title></div>).querySelector('div > title')), 'html');
    // A build that threw inside an svg: the fallback and what follows are HTML.
    assert.equal(ns(shown(() => <div><Recover fallback={<a href="#f">f</a>}><svg><g><Bad /></g></svg></Recover></div>).querySelector('a')), 'html');
    assert.equal(ns(shown(() => <div><Recover fallback={null}><svg><g><Bad /></g></svg></Recover><a href="#a">a</a></div>).querySelector('a')), 'html');
    // Written inside: SVG in an svg (a foreignObject's null content leaves nothing), HTML in HTML.
    const direct = shown(() => <div><svg><title>t</title><a href="#q"><text>q</text></a></svg><a href="#b">b</a></div>);
    assert.deepEqual([...direct.querySelectorAll('a')].map(ns), ['svg', 'html']);
    assert.equal(ns(direct.querySelector('svg title')), 'svg');
    assert.equal(ns(shown(() => <svg><foreignObject><Nothing /></foreignObject><a href="#q"><text>q</text></a></svg>).querySelector('a')), 'svg');
    // A component's own root takes the namespace of where it goes, the same compiled or not, and a template of it made inside an svg keeps none of it.
    const parts = shown(() => <div><svg><Link c="in" /></svg><Link c="out" /></div>);
    assert.deepEqual([ns(parts.querySelector('a.in')), ns(parts.querySelector('a.out'))], ['svg', 'html']);
    // Built by the runtime around a component the compiler made a template of: first inside an svg, then in HTML.
    const mixed = shown(() => jsx('div', { children: [jsx('svg', { children: jsx(Link, { c: 'first' }) }), jsx(Link, { c: 'then' })] }));
    assert.deepEqual([ns(mixed.querySelector('a.first')), ns(mixed.querySelector('a.then'))], ['svg', 'html'], 'a template made inside an svg keeps no namespace of it');
  });

  it('separates the parts a child shows ($parts): For rows, a Show showing nothing skipped, an accessor, nested arrays', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, ['x', 'y']);
    const on = $signal(root, false);
    /** @param {{ children?: any }} props */
    const Group = props => (
      <nav>
        <For each={$parts(props.children)}>{(part, i) => [() => (i() > 0 ? <hr /> : null), part]}</For>
      </nav>
    );
    render(() => (
      <Group>
        <a href="#a">a</a>
        <For each={items}>{x => <b>{x}</b>}</For>
        <Show when={on}><i>shown</i></Show>
        {() => ($read(on) ? <u>on</u> : null)}
        {[[<s>s</s>], <Label text="label" />]}
      </Group>
    ), container, { root });
    const nav = /** @type {any} */ (container.querySelector('nav'));
    assert.equal(nav.innerHTML.replace(/ data-ren="Label" style="[^"]*"/, ''), '<a href="#a">a</a><hr><b>x</b><hr><b>y</b><hr><s>s</s><hr><span>label</span>');
    $write(on, true);
    $write(items, ['y', 'z']);
    assert.deepEqual([...nav.children].map((/** @type {any} */ c) => c.localName), ['a', 'hr', 'b', 'hr', 'b', 'hr', 'i', 'hr', 'u', 'hr', 's', 'hr', 'span']);
    assert.deepEqual([...nav.querySelectorAll('b')].map((/** @type {any} */ b) => b.textContent), ['y', 'z']);
  });

  it('builds the parts $parts separates in the namespace of the element their list is in: SVG under <svg>', () => {
    const { container } = setup();
    const root = $root('app');
    const on = $signal(root, false);
    /** @param {{ children?: any }} props */
    const Wrap = props => (
      <svg>
        <For each={$parts(props.children)}>{part => part}</For>
      </svg>
    );
    render(() => (
      <Wrap>
        <a href="#a" />
        <title>t</title>
        <Show when={on}><a class="later" href="#l" /></Show>
      </Wrap>
    ), container, { root });
    const svg = /** @type {any} */ (container.querySelector('svg'));
    const SVG = 'http://www.w3.org/2000/svg';
    assert.deepEqual([...svg.children].map((/** @type {any} */ c) => [c.localName, c.namespaceURI]), [['a', SVG], ['title', SVG]]);
    $write(on, true);
    assert.deepEqual([...svg.children].map((/** @type {any} */ c) => [c.localName, c.namespaceURI]), [['a', SVG], ['title', SVG], ['a', SVG]], 'a part shown later is SVG too');
  });

  it('makes content a later update builds in the namespace of where it goes: SVG, MathML, HTML', () => {
    const { container } = setup();
    const root = $root('app');
    const on = $signal(root, false);
    const items = $signal(root, ['p']);
    const Link = (/** @type {any} */ p) => <a href={`#${p.c}`} class={p.c}><title>{p.c}</title></a>;
    render(() => (
      <div>
        <svg>
          <Show when={on}><a href="#s" class="shown"><text>s</text></a><Link c="part" /></Show>
          <For each={items}>{c => <Link c={c} />}</For>
          <g>{() => ($read(on) ? <style class="late">{'a {}'}</style> : null)}</g>
        </svg>
        <math>
          <mrow>
            <mi>x</mi>
            <Show when={on}><mo class="op">+</mo><mi class="text"><b>y</b></mi></Show>
          </mrow>
        </math>
        <Show when={on}><mi class="loose">z</mi><a href="#h" class="html">h</a></Show>
      </div>
    ), container, { root });
    $write(on, true);
    $write(items, ['p', 'q']);
    /** @param {string} selector */
    const ns = selector => {
      const el = /** @type {any} */ (container.querySelector(selector));
      return el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : el.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ? 'math' : 'html';
    };
    assert.deepEqual(['a.shown', 'a.part', 'a.part title', 'a.p', 'a.q', 'style.late'].map(ns), ['svg', 'svg', 'svg', 'svg', 'svg', 'svg'], 'inside the svg');
    assert.deepEqual(['math', 'mrow', 'mi', 'mo.op', 'mi.text'].map(ns), ['math', 'math', 'math', 'math', 'math'], 'inside the math');
    assert.equal(ns('mi.text b'), 'html', 'inside a text integration point: HTML');
    assert.deepEqual(['mi.loose', 'a.html'].map(ns), ['html', 'html'], 'outside both: HTML');
  });
  it('listens for touchstart and touchmove as not passive, so a handler can prevent the scroll', () => {
    const { window, container } = setup();
    const body = /** @type {any} */ (window.document.body);
    /** @type {Record<string, any>} */
    const options = {};
    for (const target of [container, body]) {
      const add = target.addEventListener.bind(target);
      target.addEventListener = (/** @type {string} */ type, /** @type {any} */ fn, /** @type {any} */ o) => {
        if (type.startsWith('touch')) options[`${target === body ? 'body' : 'container'} ${type}`] = o;
        return add(type, fn, o);
      };
    }
    render(() => (
      <div>
        <p onTouchStart={(/** @type {any} */ e) => e.preventDefault()} onTouchMove={(/** @type {any} */ e) => e.preventDefault()}>x</p>
        <Portal into={body}><p onTouchMove={(/** @type {any} */ e) => e.preventDefault()}>y</p></Portal>
      </div>
    ), container);
    // Chrome makes a touch listener on the body (a portal's target) passive unless told: preventDefault did nothing there.
    assert.equal(options['body touchmove']?.passive, false, JSON.stringify(options));
    assert.equal(options['container touchmove']?.passive, false);
    assert.equal(options['container touchstart']?.passive, false);
  });
  it('writes an Action\'s selected as aria-pressed only without a role', () => {
    const { container } = setup();
    const root = $root('app');
    const role = $signal(root, /** @type {any} */ (undefined));
    render(() => (
      <div>
        <Action text="plain" selected />
        <Action text="tab" role="tab" aria-selected="true" selected />
        <Action text="switch" selected role="switch" aria-checked="true" />
        <Action text="later" selected={false} role={() => $read(role)} />
      </div>
    ), container, { root });
    const [plain, tab, sw, later] = /** @type {any[]} */ ([...container.querySelectorAll('[data-ren="Action"]')]);
    assert.equal(plain.getAttribute('aria-pressed'), 'true', 'a toggle button');
    assert.equal(tab.getAttribute('aria-pressed'), null, 'a tab carries aria-selected, not aria-pressed');
    assert.equal(sw.getAttribute('aria-pressed'), null, 'a switch carries aria-checked, whichever prop comes first');
    assert.equal(later.getAttribute('aria-pressed'), 'false');
    $write(role, 'tab');
    assert.equal(later.getAttribute('aria-pressed'), null, 'a role given later takes it off');
    $write(role, undefined);
    assert.equal(later.getAttribute('aria-pressed'), 'false', 'and without it again, it comes back');
  });
  it('makes a shared name written directly inside an SVG element SVG, compiled or not', () => {
    const ns = (/** @type {any} */ el) => (el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : 'html');
    const { container } = setup();
    render(() => (
      <div>
        <svg><a href="#x">x</a><title>t</title><style>{'a { fill: red }'}</style></svg>
        <svg><g><a href="#y"><text>y</text></a></g><foreignObject><div><a href="#z">z</a></div></foreignObject></svg>
      </div>
    ), container);
    const svgs = [...container.querySelectorAll('svg')];
    // Both passes (the runtime's and ren-core/esbuild's) run this test.
    assert.deepEqual([...svgs[0].children].map(ns), ['svg', 'svg', 'svg'], 'a, title and style directly inside an svg');
    assert.equal(ns(svgs[1].querySelector('g > a')), 'svg', 'inside a g');
    assert.equal(ns(svgs[1].querySelector('div a')), 'html', 'inside a foreignObject\'s HTML');
  });
  it('makes an Action a toggle only when selected is given: null or undefined write no aria-pressed', () => {
    const { container } = setup();
    const root = $root('app');
    const selected = $signal(root, /** @type {any} */ (true));
    render(() => (
      <div>
        <Action text="none" selected={undefined} />
        <Action text="null" selected={null} />
        <Action text="flip" selected={() => $read(selected)} />
      </div>
    ), container, { root });
    const [none, nil, flip] = /** @type {any[]} */ ([...container.querySelectorAll('[data-ren="Action"]')]);
    assert.equal(none.getAttribute('aria-pressed'), null);
    assert.equal(nil.getAttribute('aria-pressed'), null, 'null is not false');
    assert.equal(flip.getAttribute('aria-pressed'), 'true');
    $write(selected, false);
    assert.equal(flip.getAttribute('aria-pressed'), 'false');
    $write(selected, null);
    assert.equal(flip.getAttribute('aria-pressed'), null, 'no longer a toggle');
  });
  it('keeps a state rule to itself: a custom value with an open string or a comment cannot swallow the next rule', () => {
    const { window, container } = setup();
    render(() => (
      <div>
        <View style={{ hover: { '--x': '"abc' } }} />
        <View style={{ hover: { '--y': 'a /* b', '--z': 'url(x', background: 'rgb(0, 128, 0)' } }} />
        <View style={{ background: 'rgb(0, 0, 255)', hover: { background: 'rgb(255, 0, 0)' } }} />
      </div>
    ), container);
    const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]')).textContent;
    assert.doesNotMatch(sheet, /"abc|\/\*|url\(x/, sheet);
    const [, second, third] = /** @type {any[]} */ ([...container.querySelectorAll('[data-ren="View"]')]).map(v => v.getAttribute('data-ren-state'));
    assert.match(sheet, new RegExp(`\\.${second}:hover \\{ background: rgb\\(0, 128, 0\\) !important \\}`), 'the pair beside a refused one stays');
    assert.match(sheet, new RegExp(`\\.${third}:hover \\{ background: rgb\\(255, 0, 0\\) !important \\}`), 'the next View keeps its rule');
  });

  // Values that tried to reach past their declaration in the state sheet's
  // text, and values alike that are safe. CSS reads CRLF, CR and form feed
  // as a newline, which ends a string.
  const ATTEMPTS = /** @type {[string, string, boolean][]} */ ([
    ['a form feed in a string', '"a\fb"', false],
    ['a line feed in a string', '"a\nb"', false],
    ['a carriage return in a string', '"a\rb"', false],
    ['a CRLF in a string', '"a\r\nb"', false],
    ['an escaped form feed in a string', '"a\\\fb"', false],
    ['a bare form feed', 'a\fb', false],
    ['an open double-quoted string', '"abc', false],
    ['an open single-quoted string', "'abc", false],
    ['a string whose end quote is escaped', '"abc\\"', false],
    ['a trailing backslash', 'a\\', false],
    ['a backslash before a form feed', 'a\\\f', false],
    ['a comment', 'a /* b', false],
    ['a closed comment', 'a /**/ b', false],
    ['an open parenthesis', 'calc(1px', false],
    ['an open bracket', '[a', false],
    ['a stray closer', 'a)', false],
    ['crossed brackets', '(a]', false],
    ['a brace', 'a}', false],
    ['a semicolon in a string', '"a;b"', false],
    ['a tag end', '"</style>"', false],
    ['an open url', 'url(x', false],
    ['a quote in an unquoted url', 'url(a"b)', false],
    ['a comment in an unquoted url', 'url(a/*)', false],
    ['an escaped url with a quote', 'u\\72l(x"a)")', false],
    ['a bracket in a name ending in url', 'rurl([)', false],
    ['a bracket after a hash named url', '#url([)', false],
    ['a bracket after an at-name url', '@url([)', false],
    ['a closed string', '"a b"', true],
    ['an escaped quote in a string', '"a\\"b"', true],
    ['an unquoted url', 'url(x.png)', true],
    ['a quoted url', 'url("a b")', true],
    ['nested parentheses', 'calc((1px + 2px) * 2)', true],
    ['an escaped brace', '\\7b', true],
  ]);
  for (const [what, value, kept] of ATTEMPTS)
    it(`${kept ? 'keeps' : 'refuses'} ${what} in a state value, the next rule intact`, () => {
      const { window, container } = setup();
      render(() => (
        <div>
          <View style={{ hover: { '--x': value } }} />
          <View style={{ background: 'rgb(0, 0, 255)', hover: { background: 'rgb(255, 0, 0)' } }} />
        </div>
      ), container);
      const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]')).textContent;
      const [first, next] = /** @type {any[]} */ ([...container.querySelectorAll('[data-ren="View"]')]).map(v => v.getAttribute('data-ren-state'));
      assert.equal(first !== null && sheet.includes(`.${first}:hover { --x: `), kept, sheet);
      assert.match(sheet, new RegExp(`(^|\\n)\\.${next}:hover \\{ background: rgb\\(255, 0, 0\\) !important \\}\\n`), 'the next rule is whole');
    });

  it('writes a state rule again for a view mounted again on the same host', () => {
    const { window, document } = setup();
    const renderer = $dom(document);
    for (let k = 0; k < 2; k++) {
      const box = document.createElement('div');
      document.body.appendChild(box);
      const dispose = mount(renderer, () => <View style={{ hover: { background: 'red' } }} />, box);
      const name = /** @type {any} */ (box.querySelector('[data-ren]')).getAttribute('data-ren-state');
      const sheet = window.document.querySelector('style[data-ren-states]')?.textContent ?? '';
      assert.match(sheet, new RegExp(`\\.${name}:hover \\{ background: red !important \\}`), `mount ${k + 1} has its rule`);
      dispose();
      box.remove();
    }
  });

  it('keeps a bounded number of composed styles while a base value changes on every frame', () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc');
    const { container } = setup();
    const root = $root('app');
    const x = $signal(root, 0);
    render(() => <View style={() => ({ left: $read(x), hover: { background: 'red' } })} />, container, { root });
    const heap = () => {
      gc();
      return process.memoryUsage().heapUsed;
    };
    for (let i = 1; i <= 5000; i++) $write(x, i);
    const before = heap();
    for (let i = 5001; i <= 45000; i++) $write(x, i);
    const grown = heap() - before;
    // Unbounded, each of the 40,000 styles kept its key (about 50 bytes a write in the sweep's run).
    assert.ok(grown < 1_000_000, `the heap grew ${(grown / 1e6).toFixed(1)} MB over 40,000 drag frames`);
  });

  it('keeps the state sheet bounded while a state value changes on every frame, the classes in use kept', () => {
    const { window, container } = setup();
    const root = $root('app');
    const x = $signal(root, 0);
    // More classes in use than the host keeps composed, each still carried by its view.
    const kept = Array.from({ length: 1100 }, (_, i) => `rgb(${i % 256}, ${i >> 8}, 7)`);
    render(() => (
      <div>
        {kept.map(color => <View style={{ hover: { background: color } }} />)}
        <View style={() => ({ hover: { opacity: String($read(x) / 100000) } })} />
      </div>
    ), container, { root });
    for (let i = 1; i <= 20000; i++) $write(x, i);
    const sheet = /** @type {any} */ (window.document.querySelector('style[data-ren-states]'));
    // Unbounded, each of the 20,000 opacities kept its rule's text node.
    assert.ok(sheet.childNodes.length <= 2 * 1101, `${sheet.childNodes.length} rules in the state sheet`);
    const text = sheet.textContent;
    const views = /** @type {any[]} */ ([...container.querySelectorAll('[data-ren="View"]')]);
    views.forEach((view, i) => {
      const name = view.getAttribute('data-ren-state');
      const value = i < kept.length ? `background: ${kept[i].replace(/[()]/g, '\\$&')}` : 'opacity: 0\\.2';
      assert.match(text, new RegExp(`\\.${name}:hover \\{ ${value} !important \\}`), `view ${i} keeps its rule`);
    });
    assert.equal(new Set(views.map(v => v.getAttribute('data-ren-state'))).size, views.length, 'no class is shared by mistake');
  });
});
