// Compiled templates (ren-core/esbuild) on the DOM: clones per document,
// dynamic parts bound by position (nested parts, refs, events, lists, components), the same DOM as the runtime
// path, the fallback build for hosts without `clone`, and reactive text
// bound as one Text node through `.data`.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { transformSync } from 'esbuild';
import { $root, $signal, $read, $write } from 'rrx-core';
import { For, Show, $active } from 'ren-core';
import { mount } from 'ren-core/host';
import { render, $dom } from 'ren-dom';
import { h, template, plan, jsx, Fragment } from 'ren-core/jsx-runtime';
import { transform } from 'ren-core/esbuild';
import { serve } from 'ren-core/worker';
import { connect } from 'ren-core/remote';
import { closeAfter } from './fixtures/after.js';


/** @type {any[]} */
const windows = [];
afterEach(async () => {
  while (windows.length > 0) await windows.pop().happyDOM.close();
});

const setup = () => {
  const window = new Window();
  windows.push(window);
  const document = window.document;
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { window, document, container };
};

/** Compiles JSX source to the module body the plugin would emit. */
const compiled = source =>
  transform(transformSync(source, { loader: 'jsx', jsx: 'transform', jsxFactory: '__ren_h', jsxFragment: '__ren_F', target: 'esnext' }).code);

/**
 * Evaluates compiled JSX (an expression of `scope`) with the runtime's
 * helpers: the compiler's own import line is dropped and its names bound.
 */
const evaluate = (source, scope) => {
  const code = compiled(`export default (${Object.keys(scope).join(', ')}) => ${source};`).replace(/^import .*\n/, '').replace('export default', 'return');
  return new Function('__ren_h', '__ren_F', '__ren_t', '__ren_p', code)(h, Fragment, template, plan)(...Object.values(scope));
};

describe('compiled templates', () => {
  it('render the same DOM as the runtime path, with nested dynamic parts', () => {
    const view = scope => `
      <div class="box" id="b" data-n={3}>
        <h1 title="t">Hi {scope.name}!</h1>
        <ul>{scope.items.map(i => <li class="i">{i}<b>{i * 2}</b></li>)}</ul>
        <p style="color: red" hidden={scope.hide} aria-hidden="true">{scope.cond ? <i>yes</i> : null}</p>
        <span>{0}{''}{false}</span>
      </div>`;
    const scope = { name: 'Ada', items: [1, 2], hide: false, cond: true };
    const a = setup();
    render(() => evaluate(view('scope'), { scope }), a.container);
    const b = setup();
    // The runtime path: the same source through the automatic runtime.
    const code = transformSync(`export default scope => ${view('scope')};`, { loader: 'jsx', jsx: 'automatic', jsxImportSource: 'ren-core' }).code;
    const runtime = new Function('jsx', 'jsxs', code.replace(/^import .*\n/m, '').replace('export default', 'return'))(jsx, jsx);
    render(() => runtime(scope), b.container);
    assert.equal(a.container.innerHTML, b.container.innerHTML);
    assert.equal(a.container.innerHTML, '<div class="box" id="b" data-n="3"><h1 title="t">Hi Ada!</h1><ul><li class="i">1<b>2</b></li><li class="i">2<b>4</b></li></ul><p style="color: red;" aria-hidden="true"><i>yes</i></p><span>0</span></div>');
  });

  it('bind reactive properties, text, events and refs by position', () => {
    const { container } = setup();
    const root = $root('app');
    const n = $signal(root, 1);
    const s = { ref: null, clicks: 0 };
    render(() => evaluate(`<p ref={r => (s.ref = r)} class={() => 'c' + $read(n)}><b>{n}</b><button onClick={() => { s.clicks++; $write(n, $read(n) + 1); }}>+</button></p>`, { $read, $write, n, s }), container, { root });
    assert.ok(s.ref === container.firstChild, 'the ref received the element');
    assert.equal(container.innerHTML, '<p class="c1"><b>1</b><button>+</button></p>');
    container.querySelector('button').click();
    assert.equal(container.innerHTML, '<p class="c2"><b>2</b><button>+</button></p>');
    assert.equal(s.clicks, 1);
  });

  it('clone a per-document template: no node shared across documents', () => {
    const p = plan(['div', { class: 'x' }, [['b', null, [0], null]], null]);
    const a = setup();
    const b = setup();
    render(() => template(p, ['one']), a.container);
    render(() => template(p, ['two']), b.container);
    render(() => template(p, ['three']), a.container);
    assert.equal(a.container.innerHTML, '<div class="x"><b>one</b></div><div class="x"><b>three</b></div>');
    assert.equal(b.container.innerHTML, '<div class="x"><b>two</b></div>');
    assert.ok(a.container.firstChild.ownerDocument === a.document);
    assert.ok(b.container.firstChild.ownerDocument === b.document);
    assert.ok(a.container.firstChild !== a.container.lastChild);
  });

  it('build through the Host calls where the host cannot clone', () => {
    const { document, container } = setup();
    const H = $dom(document);
    const host = { ...H, clone: undefined };
    const p = plan(['p', { title: 't' }, ['a', 0, ['i', null, [1], ['class', 2]]], null]);
    mount(host, () => template(p, ['b', 'c', 'k']), container);
    assert.equal(container.innerHTML, '<p title="t">ab<i class="k">c</i></p>');
  });

  it('let a list alone in its element own it', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, ['a', 'b']);
    render(() => evaluate('<ul><For each={items}>{item => <li>{item()}</li>}</For></ul>', { For, items }), container, { root });
    const ul = container.querySelector('ul');
    assert.equal(ul.childNodes.length, 2, 'no slot and no marker left');
    $write(items, ['b']);
    assert.equal(ul.innerHTML, '<li>b</li>');
  });

  it('switch a reactive slot from text to structure and back', () => {
    const { container } = setup();
    const root = $root('app');
    const v = $signal(root, 'text');
    render(() => evaluate('<div>a{() => { const x = $read(v); return x === "el" ? <b>el</b> : x; }}z</div>', { $read, v }), container, { root });
    const div = container.firstChild;
    assert.equal(div.innerHTML, 'atextz');
    assert.equal(div.childNodes.length, 3, 'a bare text node between the static texts');
    $write(v, 'el');
    assert.equal(div.textContent, 'aelz');
    assert.equal(div.querySelector('b').textContent, 'el');
    $write(v, 'again');
    assert.equal(div.textContent, 'aagainz');
  });
});

describe('compiled templates in worker mode', () => {
  it('clone on the main thread: one plan, then one record per instance', { timeout: 30000 }, async t => {
    const { document, container } = setup();
    const direct = document.createElement('div');
    const root = $root('app');
    const other = $root('app');
    const view = R => {
      const items = $signal(R, [1, 2, 3]);
      return { items, view: () => evaluate('<ul class="l"><For each={items}>{item => <li class="i"><b>{String(item())}</b>!</li>}</For></ul>', { For, items }) };
    };
    const a = view(root);
    const b = view(other);
    render(a.view, direct, { root });
    const { port1, port2 } = new MessageChannel();
    const connection = connect(port2, $dom(document), container, { schedule: 'now' });
    const session = serve(b.view, { port: port1, root: other });
    // Closed after the test however it ends, a timeout too (a finally would wait on a hung await).
    closeAfter(t, () => {
      connection.close();
      session.close();
      port1.close();
      port2.close();
    });
    await connection.idle();
    assert.equal(container.innerHTML, direct.innerHTML);
    const before = connection.totals.records;
    $write(a.items, [1, 2, 3, 4, 5, 6]);
    $write(b.items, [1, 2, 3, 4, 5, 6]);
    await connection.idle();
    assert.equal(container.innerHTML, direct.innerHTML);
    const records = connection.totals.records - before;
    assert.ok(records <= 3 * 4, `three new rows cost a few records each (${records})`);
  });
});

describe('text bindings', () => {
  it('update one Text node through data, with no markers', () => {
    const { container } = setup();
    const root = $root('app');
    const label = $signal(root, 'a');
    render(() => jsx('a', { children: label }), container, { root });
    const a = container.firstChild;
    assert.equal(a.childNodes.length, 1, 'no markers around the text');
    const text = a.firstChild;
    $write(label, 'b');
    assert.ok(a.firstChild === text, 'the same Text node');
    assert.equal(text.data, 'b');
    $write(label, 2);
    assert.equal(text.data, '2');
  });

  it('hands a signal text node to a region when its value becomes structure', () => {
    const { container } = setup();
    const root = $root('app');
    const v = $signal(root, 'a');
    render(() => jsx('p', { children: ['<', v, '>'] }), container, { root });
    const p = container.firstChild;
    const text = p.childNodes[1];
    $write(v, 'b');
    assert.ok(p.childNodes[1] === text && text.data === 'b', 'text in place');
    $write(v, jsx('i', { children: 'x' }));
    assert.equal(p.innerHTML, '&lt;<i>x</i>&gt;');
    $write(v, 'c');
    assert.equal(p.textContent, '<c>');
    $write(v, [jsx('b', { children: '1' }), '2']);
    assert.equal(p.innerHTML, '&lt;<b>1</b>2&gt;');
  });

  it('grow markers inside the element when a text becomes structure', () => {
    const { container } = setup();
    const root = $root('app');
    const on = $signal(root, false);
    const Child = () => jsx('i', { children: 'x' });
    render(() => jsx('p', { children: ['<', () => ($read(on) ? jsx(Child, {}) : 'off'), '>'] }), container, { root });
    const p = container.firstChild;
    assert.equal(p.textContent, '<off>');
    $write(on, true);
    assert.equal(p.innerHTML, '&lt;<i>x</i>&gt;');
    $write(on, false);
    assert.equal(p.textContent, '<off>');
  });

  it('keep markers for a reactive text that is a whole row', () => {
    const { container } = setup();
    const root = $root('app');
    const items = $signal(root, [1, 2]);
    const on = $signal(root, false);
    render(() => jsx('div', { children: jsx(For, { each: items, children: item => () => ($read(on) ? [jsx('b', { children: String(item()) }), '!'] : String(item())) }) }), container, { root });
    const div = container.firstChild;
    $write(on, true);
    $write(items, [2, 1]);
    assert.equal(div.textContent, '2!1!', 'rows move with every node they grew');
  });

  it('show a waiting text node inside Show without markers', () => {
    const { container } = setup();
    const root = $root('app');
    const show = $signal(root, true);
    const name = $signal(root, 'x');
    render(() => jsx('p', { children: jsx(Show, { when: show, children: jsx('b', { children: name }) }) }), container, { root });
    assert.equal(container.innerHTML, '<p><b>x</b></p>');
    $write(show, false);
    assert.equal(container.firstChild.textContent, '');
    $write(show, true);
    $write(name, 'y');
    assert.equal(container.firstChild.textContent, 'y');
    void $active;
  });
});
