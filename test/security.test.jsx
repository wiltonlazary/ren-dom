// What would run script is never written (security): a javascript: URL in
// any attribute a browser loads, follows or submits to, as a browser's URL
// parser reads it (any case, leading controls and spaces, tabs and line
// breaks inside), an href a URL part makes javascript:, an iframe's srcdoc,
// a javascript: value of an SVG animation, and an event handler given as a
// string (any on* name, any case, any element). Such a prop removes the
// attribute, as null does; a handler is a function. Literal tags, so the compiled pass writes them
// from templates too.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { $signal, $write, $root } from 'rrx-core';
import { render } from 'ren-dom';

/** @type {HappyWindow[]} */
const windows = [];
afterEach(async () => {
  for (const window of windows.splice(0)) await window.happyDOM.close();
});
const setup = () => {
  const window = new HappyWindow();
  windows.push(window);
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  return container;
};

/** javascript: URLs as a browser's URL parser reads them. */
const SCRIPTED = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  '\u0001\u0000 javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\rscript:alert(1)',
  '\n\tjavascript:alert(1)',
];
/** Not javascript: to a browser: written as given. */
const PLAIN = ['https://example.com/a', '/javascript:x', 'javascript', ' javascript:x', 'java\u0000script:x', 'mailto:a@example.com'];

/** Each URL attribute on an element that has it, as a view of `url`, and the attribute's name. @type {[string, (url: any) => any][]} */
const LINKS = [
  ['href', url => <a href={url}>x</a>],
  ['href', url => <map><area href={url} /></map>],
  ['href', url => <link rel="stylesheet" href={url} />],
  ['href', url => <base href={url} />],
  ['action', url => <form action={url} />],
  ['formaction', url => <button formAction={url}>b</button>],
  ['formaction', url => <input type="submit" formaction={url} />],
  ['src', url => <iframe src={url} />],
  ['src', url => <embed src={url} />],
  ['src', url => <script src={url} />],
  ['src', url => <img src={url} />],
  ['data', url => <object data={url} />],
  ['poster', url => <video poster={url} />],
  ['cite', url => <blockquote cite={url}>q</blockquote>],
  ['background', url => <table background={url} />],
  ['codebase', url => <object codeBase={url} />],
  ['longdesc', url => <img longDesc={url} />],
  ['href', url => <svg><a href={url}><text>x</text></a></svg>],
  ['href', url => <svg><use href={url} /></svg>],
  ['xlink:href', url => <svg><a {...{ 'xlink:href': url }}><text>x</text></a></svg>],
  ['HREF', url => <a {...{ HREF: url }}>x</a>],
];

/** The element a view made. @param {Element} container */
const made = container => /** @type {Element} */ (container.querySelector('a, area, link, base, form, button, input, iframe, embed, script, img, object, video, blockquote, table, use'));

describe('ren dom security', () => {
  it('writes no javascript: URL, however cased or spaced, in any URL attribute', () => {
    for (const [attribute, view] of LINKS) {
      for (const url of [...SCRIPTED, new URL('javascript:alert(1)')]) {
        const container = setup();
        const dispose = render(() => view(url), container);
        assert.equal(made(container).getAttribute(attribute), null, `${attribute}=${JSON.stringify(String(url))}: ${container.innerHTML}`);
        assert.ok(!/script:/i.test(container.innerHTML.replace(/[\t\n\r]/g, '')), container.innerHTML);
        dispose();
      }
      for (const url of PLAIN) {
        const container = setup();
        const dispose = render(() => view(url), container);
        assert.equal(made(container).getAttribute(attribute), url, `${attribute}=${JSON.stringify(url)} is written`);
        dispose();
      }
    }
  });

  it('blocks exactly the URLs the full URL parser reading blocks, its first-character shortcut included', () => {
    // The reading in full: leading C0 controls and spaces dropped, tabs and line breaks ignored, any ASCII case.
    const full = (/** @type {unknown} */ value) => /^javascript:/i.test(String(value).replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, ''));
    let seed = 0x9e3779b9;
    const random = (/** @type {number} */ n) => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) % n);
    const pick = (/** @type {string[]} */ xs) => xs[random(xs.length)];
    const LEAD = ['', ' ', '\t', '\n', '\r', '\f', '\u0000', '\u0001', '\u001f', ' ', ' ', '　', '﻿', 'x'];
    const INSIDE = ['', '\t', '\n', '\r', ' ', '\u0000', '­'];
    const LOOKALIKE = { j: ['ĵ', 'ј', 'ｊ', 'ʝ'], a: ['а', 'ａ'], s: ['ſ', 'ѕ'], c: ['с'], r: ['г'], i: ['ı', 'і'], p: ['р'], t: ['т'], v: ['ν'] };
    const values = [...SCRIPTED, ...PLAIN, '', 'j', 'J', 'javascript:', 'javascript', 'jscript:x', 'vbscript:x', 'data:text/html,x', '#a', '/a', 'https://a'];
    for (let i = 0; i < 3000; i++) {
      let url = '';
      for (let n = random(4); n > 0; n--) url += pick(LEAD);
      for (const ch of 'javascript:') {
        const letter = random(12) === 0 && ch in LOOKALIKE ? pick(LOOKALIKE[/** @type {keyof typeof LOOKALIKE} */ (ch)]) : random(2) ? ch.toUpperCase() : ch;
        url += letter + (random(6) === 0 ? pick(INSIDE) : '');
      }
      values.push(url + pick(['alert(1)', '', 'x']));
    }
    const container = setup();
    const root = $root('app');
    {
      const href = $signal(root, /** @type {unknown} */ ('/start'));
      render(() => <a href={href}>x</a>, container, { root });
      const a = /** @type {Element} */ (container.querySelector('a'));
      const others = [0, 12, new URL('javascript:alert(1)'), new URL('https://a/'), { toString: () => ' JAVA\tscript:x' }, { toString: () => 'jav' }];
      let blocked = 0;
      for (const value of [...values, ...others]) {
        $write(href, '/between');
        $write(href, value);
        const expected = full(value) ? null : String(value);
        if (expected === null) blocked++;
        assert.equal(a.getAttribute('href'), expected, JSON.stringify(String(value)));
      }
      assert.ok(blocked > 200 && blocked < values.length, `both outcomes generated: ${blocked} blocked`);
    }
  });

  it('writes none from a literal attribute, compiled or not', () => {
    const container = setup();
    const dispose = render(
      () => (
        <div>
          <a href="javascript:alert(1)">a</a>
          <form action=" JAVASCRIPT:alert(1)" />
          <iframe src="java&#9;script:alert(1)" />
          <svg>
            <a href="javascript:alert(1)">
              <text>x</text>
            </a>
          </svg>
        </div>
      ),
      container,
    );
    assert.equal(container.innerHTML, '<div><a>a</a><form></form><iframe></iframe><svg><a><text>x</text></a></svg></div>');
    dispose();
  });

  it('removes an href that turns javascript:, and writes it again once it is not', () => {
    const container = setup();
    const root = $root('app');
    {
      const href = $signal(root, '/safe');
      render(() => <a href={href}>x</a>, container, { root });
      const a = /** @type {Element} */ (container.querySelector('a'));
      assert.equal(a.getAttribute('href'), '/safe');
      $write(href, 'javascript:alert(1)');
      assert.equal(a.getAttribute('href'), null, 'the earlier URL does not stay');
      $write(href, '/back');
      assert.equal(a.getAttribute('href'), '/back');
    }
  });

  it('drops an href a URL part makes javascript:', () => {
    const container = setup();
    const dispose = render(
      () => (
        <div>
          <a href="mailto:alert(1)" protocol="javascript:">
            a
          </a>
          <map>
            <area href="mailto:alert(1)" protocol="JavaScript:" />
          </map>
          <a href="https://example.com/p" pathname="/q">
            b
          </a>
        </div>
      ),
      container,
    );
    const [a, b] = container.querySelectorAll('a');
    assert.equal(a.getAttribute('href'), null, container.innerHTML);
    assert.equal(/** @type {Element} */ (container.querySelector('area')).getAttribute('href'), null);
    assert.equal(b.getAttribute('href'), 'https://example.com/q', 'another part edits the href');
    dispose();
  });

  it('writes no srcdoc: an iframe holds no markup of its own', () => {
    const container = setup();
    const dispose = render(
      () => (
        <div>
          <iframe srcdoc="<script>alert(1)</script>" />
          <iframe srcDoc="<p>x</p>" />
          <iframe {...{ SRCDOC: '<img src=x onerror=alert(1)>' }} />
        </div>
      ),
      container,
    );
    assert.equal(container.innerHTML, '<div><iframe></iframe><iframe></iframe><iframe></iframe></div>');
    dispose();
  });

  it('writes no javascript: value of an SVG animation, which would make a live link', () => {
    const container = setup();
    const Animate = /** @type {any} */ ('animate');
    const SetTag = /** @type {any} */ ('set');
    const dispose = render(
      () => (
        <svg>
          <a href="#a">
            <Animate attributeName="href" values="#a;javascript:alert(1)" />
            <SetTag attributeName="href" to=" JavaScript:alert(1)" />
            <Animate attributeName="href" from="javascript:alert(1)" by="javascript:alert(2)" />
            <SetTag attributeName="href" to="#b" />
            <text>x</text>
          </a>
        </svg>
      ),
      container,
    );
    assert.equal(container.innerHTML, '<svg><a href="#a"><animate attributeName="href"></animate><set attributeName="href"></set><animate attributeName="href"></animate><set attributeName="href" to="#b"></set><text>x</text></a></svg>');
    dispose();
  });

  it('writes no on* string, any case, on an HTML, SVG or MathML element', () => {
    const container = setup();
    const MathTag = /** @type {any} */ ('math');
    const Mi = /** @type {any} */ ('mi');
    const dispose = render(
      () => (
        <div>
          <p onclick="alert(1)">a</p>
          <img onerror="alert(1)" src="x.png" />
          <p {...{ ONCLICK: 'alert(1)', Onmouseover: 'alert(2)', onfoo: 'x', ['onclic\u212A']: 'alert(3)' }}>b</p>
          <button {...{ onClick: 'alert(1)' }}>c</button>
          <svg onload="alert(1)">
            <circle onclick="alert(1)" {...{ ONLOAD: 'alert(2)' }} />
          </svg>
          <MathTag onclick="alert(1)">
            <Mi>x</Mi>
          </MathTag>
        </div>
      ),
      container,
    );
    assert.equal(container.innerHTML, '<div><p>a</p><img src="x.png"><p>b</p><button>c</button><svg><circle></circle></svg><math><mi>x</mi></math></div>');
    for (const el of /** @type {any[]} */ ([...container.querySelectorAll('*')])) assert.equal(el.onclick ?? null, null, `${el.localName} holds no string handler`);
    dispose();
  });

  it('keeps a handler given as a function, on an HTML or an SVG element, writing no attribute', () => {
    const container = setup();
    /** @type {string[]} */
    const heard = [];
    const root = $root('app');
    const handler = $signal(root, /** @type {any} */ (() => heard.push('svg')));
    render(
      () => (
        <div>
          <button onclick={() => heard.push('button')}>b</button>
          <svg>
            <circle onclick={handler} />
          </svg>
        </div>
      ),
      container,
      { root },
    );
    const button = /** @type {any} */ (container.querySelector('button'));
    const circle = /** @type {any} */ (container.querySelector('circle'));
    button.click();
    circle.dispatchEvent(new circle.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(heard, ['button', 'svg']);
    assert.equal(container.innerHTML, '<div><button>b</button><svg><circle></circle></svg></div>', 'no attribute: a function is no markup');
    // A function replaced by a string: the handler goes, and no attribute comes.
    $write(handler, 'alert(1)');
    assert.equal(circle.onclick, null);
    assert.equal(circle.getAttribute('onclick'), null);
  });
});
