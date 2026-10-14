# ren-dom

The fine-grained DOM renderer for [ren-core](https://github.com/wiltonlazary/ren-core): `$dom`
renders into the light DOM and `$shadow` into a shadow root. Both are a ren-core
`Host` (`ren-core/host`). Bindings write the DOM directly in the Render phase;
there is no virtual DOM and no diff beyond each property's previous value.
Plain JavaScript with JSDoc types, strict `tsc` checking and generated
declarations.

The package is published on npm as `@maxenve/ren-dom` under the MIT license;
install it under its import name: `npm install ren-dom@npm:@maxenve/ren-dom`.
Its one runtime dependency is ren-core (linked from the sibling
checkout, `file:../../../ren-core/wtree/_repo_`), which brings rrx-core. It can share a
page with ren-skia and ren-three: each application root has its own renderer.

```jsx
import { Root, $signal, $read, $write, $active, For, View, Label, Action } from 'ren-core';
import { $dom, $shadow, render } from 'ren-dom';

const App = () => {
  const items = $signal($active(), [{ id: 1, title: 'milk' }]);
  return (
    <View gap={8}>
      <Label text={() => `${$read(items).length} items`} />
      <Action text="Add" onPress={() => $write(items, [...$read(items), { id: Date.now(), title: 'new' }])} />
      <ul><For each={items} by={item => item.id}>{item => <li>{() => item().title}</li>}</For></ul>
      <Root id="side" renderer={$shadow({ theme: { accent: 0xff445566 } })}>{() => <Side />}</Root>
    </View>
  );
};

const main = Root({ id: 'main', target: document.body, renderer: $dom(document), children: <App /> });
// or, without an application root:
const dispose = render(() => <App />, document.getElementById('app'));
```

| Export | What |
| --- | --- |
| `$dom(document, options)` | the light-DOM Host |
| `$shadow(options)` | the Host that renders into a shadow root its application root attaches |
| `render(view, container, options)` | `mount` with `$dom` of the container's document; returns the dispose function |
| `color(argb)` | a theme color as a CSS color |

## Elements

ren-core's portable primitives (`View`, `Layout`, `Scroll`, `Label`, `Edit`,
`Action`, `Image`, `Shape`) map to DOM elements with the portable properties
of the ren-core view protocol (`data-ren="<Primitive>"`, styled by the renderer's
sheet). Any other tag is an HTML, SVG or MathML element with DOM
properties, attributes and events, made in the namespace the element it
goes into gives it (the Host's `element` hears that parent), as the HTML
parser reads markup, compiled or not, and for content a `Show`, a `For` or
a component makes later as for what is written in place. An SVG element's
name (`circle`, `image`, `filter`, `feGaussianBlur`, `foreignObject`, …)
makes it SVG wherever it stands, and `math` MathML; a name HTML shares with
SVG (`a`, `script`, `style`, `title`) is SVG inside an SVG element (not
inside a `foreignObject`): `<svg><Link /></svg>`, where `Link` returns an
`<a>`, makes an SVG link. A MathML name (`mrow`, `mi`, `mo`, …) is MathML
inside a MathML element (not inside a text integration point: `mi`, `mo`,
`mn`, `ms`, `mtext`, where HTML goes on). Anywhere else an element is
HTML. A compiled template whose root takes its namespace from where it goes
is cloned from one copy per namespace.

A primitive's `style` is ren-core's portable style, written as CSS straight
from the object (a browser reads the colors and lengths itself): the box
model's defaults are inline on every primitive as it is made (border-box;
`position: relative`, so a primitive is the containing block of its
absolute children and paints in tree order but for stacking contexts, as
the canvases place and paint them; a style that stops setting the position
gives it back; a Scroll keeps room for its bar whether or not it overflows
(`scrollbar-gutter: stable`; the sheet draws the bar as the canvases do, the
theme's `bar` wide, in WebKit and Blink by `::-webkit-scrollbar`; a browser without it, Firefox, gets the standard `scrollbar-color`, the same thumb and track, and `scrollbar-width`, thin up to a 10 px bar, only inside `@supports not selector(::-webkit-scrollbar)`, since Chrome 121+ drops its `::-webkit-scrollbar` look where either is set; a style's `scrollbarWidth` and `scrollbarColor` reach that drawing as custom properties, `--ren-bar-size` and `--ren-bars` (`'thin'`: half the bar, `'none'`: none, on the Scroll alone: the sheet starts each Scroll from the theme's) and `--ren-thumb` and `--ren-track` (inherited, as CSS's scrollbar-color)); containers are column flex boxes, and so is an Action, its
content centered along it as the canvases lay it out; Labels keep line breaks and wrap only with
`wrap`; Actions and Edits a field high, Edits the theme's entry width at
least), so it holds without the sheet; the rest is the browser's own CSS,
grid included. The
`hover`, `press` and `focus` styles become one class per distinct set of
rules in the host's own stylesheet (`:hover`, `:active`, `:focus`). A style
overrides the shorthand props that set the same thing, and gives them back
when it stops. Names outside the vocabulary are written as CSS: the DOM
only. ren-skia and ren-three draw the same style through ren-canv.

An Edit is an `input` (a `textarea` with `lines` above 1; `size` 1 and
`cols` 1, so its width is the theme's entry, as the canvases size it): its
`disabled` and `readOnly` are the element's, and the sheet dims a
disabled one (`--ren-soft` fill, `--ren-muted` text); `secret` makes an
input `type="password"` (a textarea has none); `autosize` gives a
textarea CSS's `field-sizing: content` (with `contain: inline-size`: it
grows down only, its width its box's, as on the canvases) between its `lines` and
`autosize` rows as `min-height` and `max-height` (browsers without
field-sizing keep its `lines` rows), each row a line of its own font and
line height (`1lh`) past a field's height, and padded so its first row sits
where a one-line field's text does, less its own top border, as the
canvases size it; a `minHeight`, `maxHeight` or
`height` its style sets wins over autosize's in either order, as on the
canvases, and autosize's comes back when the style drops it; the style's `placeholderColor` is
the `--ren-placeholder` custom property, inherited, which the sheet's
`::placeholder` rule reads (`--ren-muted` otherwise; with `styles: false`
the application's CSS decides). The caret API (`setSelectionRange`,
`selectionStart`, `selectionEnd`) is the element's own. A Label's
`lines` is a line clamp (`-webkit-line-clamp` in a `-webkit-box`, and
CSS's `line-clamp`, wrapping, `overflow: hidden`); its `ellipsis` is one
line with `text-overflow: ellipsis`. A Label's `runs` are a `span` per
run in the Label's element, each with its run's style inline (the text
part of the vocabulary, as CSS; the rest inherits from the Label, whose
`white-space`, wrapping and clamp stay its own), a run's `onPress` a
`click` listener on its span (before the Label's own, as it bubbles);
`text` replaces them, as they replace `text`.

An Edit's `runs` style its value while the field stays the Edit's element
(its ref, `value`, focus and selection API, native caret, selection, IME,
undo and clipboard): a field cannot style its text, so a mirror (a `div`
with `data-ren-mirror`, `aria-hidden`, hearing no pointer) is placed
right after the field in its parent, over the field's border box by CSS
anchor positioning (`anchor-name` on the field; measured offsets where a
browser has no anchors). It copies the field's computed font, padding,
borders, color and (a textarea's) wrapping and content width, holds a
`span` per run in its style (a run's size and family stay the field's;
in a font whose bold is wider than its regular text, measured once per
font on a canvas, a weight is a stroke around the regular glyphs,
`-webkit-text-stroke` as a browser synthesizes a bold its font lacks,
which moves no glyph, and an italic wider than the regular text is left
out, so the text never leaves the caret: a monospace font keeps both
faces), and follows the field's scroll. A run's `background` is not the
mirror's (over the field it would hide the caret and the selection): it is
a layer of the field's own background, in front of the field's layers (its
computed lists) at each box of the run's span measured in the mirror
(`background-origin: border-box`, clipped to the padding box, placed again
as the field scrolls), so the native caret and selection paint over it and
the field's color stays under all; the field's own inline background
properties come back when the runs stop showing. While the runs' texts joined are the value, the field has
`data-ren-runs` and `-webkit-text-fill-color: transparent` (its caret
keeps its color; the sheet keeps selected glyphs transparent); otherwise
(a draft the view has not answered yet, a composition, a password, an
empty value for its placeholder) the mirror hides and the field shows
its own text. It resyncs on the field's `input`, focus, blur, scroll and
composition events, each property set on the Edit, a ResizeObserver's
reports and `setTheme`. ren-core never sees the mirror: `insert` moves it
with its field, `remove` and `clear` take it, `next` steps over it.

`hidden` false (or unset) gives a
primitive back the display it shows with: its style's, its clamp's, else
its base's.

### What is never written

A prop that would run script writes nothing and removes its attribute, as
null does, so no earlier value stays (no throw: the rest of the view
renders):

- an event handler given as anything but a function: any prop whose name
  starts with `on`, in any ASCII case (`onclick`, `ONCLICK`, `onload` on an
  `svg`), on any element. A function on a name the element has a handler
  property for (`onclick={fn}`, on HTML, SVG and MathML elements) is set
  there, writing no attribute; `onClick` and the other `on` + capital
  names are ren-core's handlers;
- a `javascript:` URL, as a browser's URL parser reads it (any ASCII case,
  leading C0 controls and spaces, tabs and line breaks anywhere), in any
  attribute or property whose value is a URL a browser loads, follows or
  submits to: `href` (on HTML, SVG and MathML elements), `src`, `action`,
  `formaction`, `xlink:href`, `poster`, `data`, `cite`, `background`,
  `codebase`, `classid`, `longdesc`, `manifest`, `icon`, `profile`,
  `archive`, `lowsrc`, `dynsrc`, in any case;
- an `href` a URL part (`protocol`, `hash`, `host` and the rest, on an `a`
  or `area`) makes `javascript:`: the edit is made and the href dropped;
- an SVG `animate`'s or `set`'s `to`, `from`, `by` or `values` holding a
  `javascript:` URL, which would make the link it animates live;
- `srcdoc`, in any case: an iframe's document of markup. Render the
  document's content as elements, or give the iframe a URL.

Other schemes (`data:`, `blob:`) are written as given. ren-html, which
renders through ren-dom, writes the same.

A Shape is an `svg` of one element per record (`line`, `rect`, `ellipse`,
`path`); a record's `fill` is its `fill` attribute, a color or a
`linearGradient`/`radialGradient` in the svg's `defs` in user space over
the figure's bounds, along the line the canvases take. The skews
(`skewX`, `skewY`) are CSS's `transform: skew()`, which applies after the
`translate`, `rotate` and `scale` properties.

## Options

| Renderer | Options |
| --- | --- |
| `$dom(document, options)` | `layout` (a layout engine instead of the browser's, below), `font` and `mono` (below), `theme` (token overrides, set on the host element as `--ren-<token>` custom properties, colors as CSS colors and metrics in px, every token so nothing inherits from an outer root; never on `:root` or the document), `styles` (true: a `<style data-ren-style>` inside the host element whose selectors are `[data-ren-root="<id>"] …:not([data-ren-root="<id>"] [data-ren-root] *)`, so they stop at nested roots; false: none; a string: extra CSS inside `@scope ([data-ren-root="<id>"]) to ([data-ren-root])`) |
| `$shadow(options)` | `mode` (`'open'` or `'closed'`), `document` (the document it builds in before `open`; the global one by default), and every `$dom` option (`layout`, `font`, `mono`, `theme`, `styles`); the root attaches a shadow root to its host element and renders into it; the stylesheet is a constructable `CSSStyleSheet` adopted by that shadow root (a `<style>` inside it where constructable sheets are missing); portals render into the shadow root |

Both hosts implement `nest()`: a `<Root>` nested in their views without a
`renderer` renders into the light DOM (`$dom` of the same document), and any
other renderer (ren-skia, ren-three) can be nested in them, since their
elements hold a nested root's host element.

### Text in the canvases' fonts (`font`, `mono`)

ren-skia and ren-three draw text in the typeface they are given (`font`,
and `mono` for families naming monospace) and measure it by its advances,
with no kerning or ligatures. Given the same fonts (the bytes, or a URL of
the file), a DOM root sets its text the same way, so its boxes match
theirs: `$dom(document, { font: './font.ttf', mono: './mono.ttf' })`. Each
is added to the document's fonts (`ren-<id>`, `ren-<id>-mono`) while the
root lives; the host element takes the face as its `font-family` (the
page's own font otherwise), `--ren-mono` names the monospace one (a style's
family naming monospace is written `var(--ren-mono, <family>)`), and
`font-kerning` and `font-variant-ligatures` are `none`. Measured in Chrome
(rui-show's demos): the page's Liberation Sans set text 13.6% narrower than
the canvases' DejaVu Sans; with the same face, kerning still took 0.84 px
off a 16 px sentence.

### Layout by an engine (`layout`)

By default the browser lays out the primitives from the CSS ren-dom writes.
With `layout`, a layout engine does instead: ren-canv's `Flow`, the one
ren-skia and ren-three use (Taffy by default), in this thread or in a layout
worker.

```js
import { Flow, CanvasFonts, loadLayout, remoteLayout } from 'ren-canv';
await loadLayout(); // or: new Flow(fonts, { layout: remoteLayout(worker) })
const fonts = new CanvasFonts(document.createElement('canvas').getContext('2d'), 'system-ui');
const dom = $dom(document, { layout: new Flow(fonts) });
```

- Each primitive has an item in the Flow. After every flush the Flow lays
  out what changed, and each primitive whose box moved is placed there
  (`position: absolute`, `left`, `top`, `width`, `height`). The top of a view
  keeps its place in the page (`position: relative`) and takes its
  container's content width, followed with a ResizeObserver.
- The box model is the engine's: sizes, minimums and maximums, margins,
  gaps, flex and grid, the position and insets are not written as CSS
  (`zIndex` is) (state styles keep only their
  paint). Padding, borders, paint and text stay CSS, and the browser still
  draws and wraps the text.
- Text is measured by the Flow's fonts. Give it the family the page sets
  (`CanvasFonts` measures as the browser does). The browser's own line
  breaking may still differ at an edge.
- Compiled templates are built through the host calls instead of cloned, so
  every primitive has its item. HTML elements inside a primitive take no
  room.
- ren-dom does not depend on ren-canv: the option is any object with the
  Flow's calls (the `Arranger` type).
- `setTheme` reaches the layout engine: it calls the Arranger's optional
  `retheme(tokens)` (the Flow's takes the new metrics: a field's height, an
  entry's width, the text size and leading) and lays the root out on them
  at once, as the CSS takes the new tokens.

`setTheme(tokens)` on a renderer takes a new theme at once: its root's host element gets the new `--ren-*` tokens, and the view and its state stay.

## Events

`on<Name>` properties are event handlers, each run as a `$batch`. A
handler is a function: an `on*` prop given a string writes nothing (above,
"What is never written"). The DOM
renderers delegate bubbling events (`click`, `input`, `keydown`, `keyup`,
pointer, mouse and touch events, `focusin`/`focusout`, `beforeinput`,
`dblclick`, `contextmenu`): one listener per type at each delegation root (the
container a view mounts into, its shadow root for `$shadow`, a portal's
target), the handler kept on its node under the host's own key, dispatched
along `composedPath()` from the target up to that root, with `currentTarget`
set to the handler's node and `stopPropagation` honoured. A nested root has
its own host and keys, so it runs only its own handlers. Other events
(`focus`, `blur`, `scroll`, …) listen on their node. Dispose removes the
root's listeners; a delegated handler goes with its node and runs only while
its owner lives; the handlers of one row share one runner (owner and
context), kept on the node beside the handler, so binding a handler
allocates nothing. A delegated handler runs after native
listeners on its ancestors below the root, and an event dispatched on a node
outside the root (or that does not bubble) does not reach it. `prevent`
cancels default actions synchronously (ren-core event names, or true for press
and submit).

The browser sends no focusout for an element removed or hidden while
focused. When ren-dom removes (a region, a row, a clear) or hides (`hidden`)
nodes holding the focus, it blurs the focused element first, so its
ancestors hear a bubbling `focusout` (`relatedTarget` null), once, as on
ren-canv: a wrapper hears the focus leave it. A hidden element hears its
`blur` first; a removed one hears nothing (ren-core drops its handlers
before it goes), though Chrome fires its blur.

On a primitive, `onDrop`, `onDragEnter`, `onDragOver` and `onDragLeave` are
ren-core's portable ones, mapped from the DOM's own: a drop's `files` (its
dragover accepted, its default cancelled), a drag's `files` count and
`types` (the MIME types of its file items); the DOM event rides along as
`event`. On an HTML element they stay the DOM's events.

A primitive starts no native drag, as the canvases start none (its ghost
would take the pointer from the gesture pressing there, a Carousel's swipe
or a slider's thumb): an Image is `draggable="false"`, and each delegation
root cancels a `dragstart` whose target (a selection's text) is in a
primitive, unless that primitive or one around it is `draggable="true"` or
hears `onDragStart`. The HTML the application writes (an `img`, an `a`)
keeps the browser's drags.

When the browser takes a pressed pointer back (a touch it pans or zooms
with where the style's `touchAction`, CSS's `touch-action`, lets it, a
native drag, the system), `onPointerCancel` hears the DOM's own
`pointercancel`, delegated and bubbling as the other pointer events, and no
`pointerup` follows: a drag ends on either. The canvases send the same.

The style's `textTransform` is CSS's `text-transform`, except on an Edit,
which shows its value as typed on every renderer (a browser's fields take
no inherited transform either). `display: 'contents'` is CSS's on a View,
Layout or Scroll (a leaf ignores it, as on the canvases); with the `layout` option it stays in the CSS (the rest of the
box model goes to the engine), so the children, which the engine places
against the parent, sit against the parent's element.

A primitive's `label` names it (`aria-label`; an Edit's placeholder too)
until the application gives an `aria-label` of its own, which wins while it
is set: a placeholder that changes never writes over it.

An Edit's element has `caretRow()`, as a canvas Edit: the drawn row its
caret is in and its row count, `{ row, rows }` from 0. A textarea's are
measured in a hidden copy of its text box (its font, spacing, paddings and
client width, pre-wrap): its value to the caret, then the rest in a span
that starts on the caret's row (at a wrap, the next row's start); the rows
are the copy's height in lines. Where nothing is laid out it counts the
value's own lines; an input's is row 0 of 1. `scripts/caret-check.mjs`
checks it in Chrome against the rows Chrome wraps the value into.

A primitive's `tabIndex` is its `tabindex` attribute (unset or not a
number: none), so the browser makes a View, Layout or Scroll with one
focusable and keeps one of -1 out of the Tab order; `inert` is the
`inert` attribute while true, so the browser keeps the focus, the pointer,
selection and the accessibility tree from the region, and ren-core's
`$focus` (`focusables`) passes it by.

A primitive's `dir` ('ltr', 'rtl', 'auto') is its `dir` attribute (unset:
none, its parent's), so the browser sets its text and lays it out in that
direction; with the `layout` option the Flow lays it out as the canvases
do (a right-to-left box's children from its right), and the attribute
still sets its text.

Root-wide keys (ren-core's `$keys`, the host's `listen(container, 'keys')`)
listen on the document for `keydown` while a view hears them, so they run
after the root's delegated handlers (the focused element's `onKey` first;
its `stopPropagation` keeps the key from them), and take a key whose
target is inside the view's container (its shadow root; portals into it)
or the document's body (nothing has focus). The handler gets the DOM's
`KeyboardEvent`, so `preventDefault` cancels the key's default, with
`editable` set: true when the key's target (inside a shadow root too) is
an `input`, `textarea`, `select` or contenteditable element.

Root-wide scrolls (ren-core's `$scrolls`, `listen(container, 'scrolls')`)
listen on the document for `scroll` in the capture phase (scroll events do
not bubble), and on the view's shadow root too for `$shadow` (they are not
composed), and take a scroll of the page, of an element around the
container or of one inside it; a sibling's scroll moves nothing of the
view and is left out. The handler gets the DOM's `Event`.

A node's moves (ren-core's `$moves`, `listen(node, 'move')`) are
heard by an IntersectionObserver whose root is the document and whose root
margin leaves exactly the node's box (from the root's `clientWidth` and
`clientHeight`), so any move changes its ratio in the next rendering step;
the box is then measured, `{ type: 'move', x, y }` told when its place
changed, and a new observer made where it went. A box partly clipped is
observed at its ratio (a threshold on each side of it), one clipped whole
until any of it shows; it is observed at once when in the document, and a
ResizeObserver observes it again at each new size (or once it is laid out). A move under a pixel inside the margin is caught
by comparing the box on the observer's first report. Without an
IntersectionObserver nothing is heard.

The viewport (ren-core's `$viewport` and `$media`, the host's `viewport`)
is the window's `innerWidth` and `innerHeight`, as CSS media queries read
them, with its `prefers-color-scheme: dark` and `prefers-reduced-motion:
reduce` from `matchMedia`; the host listens to the window's `resize` and
those queries' `change` only while a view reads it.

## Compiled templates

With ren-core/esbuild, a tree of intrinsic elements becomes a plan. The DOM host
implements `clone`: it keeps one copy of the plan's nodes per document
(never shared across documents or roots), clones it with
`cloneNode(true)` and walks precomputed child paths to the dynamic parts. It also implements `fill` (an only text child is the element's
`textContent`) and `clear` (a run of siblings removed at once).

## Tests

```sh
(cd ../../../rrx-core/wtree/_repo_ && npm install)   # rrx-core, ren-core, then ren-canv: their installs generate the types checked here
(cd ../../../ren-core/wtree/_repo_ && npm install)
(cd ../../../ren-canv/wtree/_repo_ && npm install)   # the layout tests use its Flow
npm install        # ren-core, rrx-core and ren-canv (linked), pinned devDependencies: esbuild, happy-dom, typescript
npm test           # declarations, tsc --checkJs --strict, the TypeScript consumers, node:test twice
```

- `test/dom.test.jsx` covers the JSX components on the DOM (happy-dom).
- `test/edit.test.jsx` covers the portable Edit and Label: a controlled
  value, disabled, readOnly, secret, the placeholder's color, autosize, a
  Label's line clamp and ellipsis.
- `test/heights.test.jsx` checks a multi-line Edit's height against Chrome
  (`test/fixtures/heights.json`, recorded by `scripts/heights-oracle.mjs`
  under the Chrome lock) over fonts, line heights, autosize, paddings and
  borders: ren-dom writes what Chrome was given, and a ren-canv Document
  lays it out at Chrome's height.
- `test/edit-runs.test.jsx` covers an Edit's runs: the mirror after the
  field and the field's transparent text, typing answered by new runs, a
  draft or a composition shown plain, secret and multi-line fields, a
  run's background as the field's first background layer at the run's box
  (and the field's own given back), a weight as a stroke and an italic left
  out in a font that would widen them, and a mirror moved, removed and
  cleared with its field in lists; the worker
  mode's (`test/remote.test.jsx`) carries the runs as data.
- `test/moves.test.jsx` covers a node's moves (`$moves`) with stand-in
  observers: the root margin of its box, a move told once and observed
  again where it went, a stale report ignored, a clipped box at its ratio,
  one clipped whole waiting, and the stop with its owner.
- `test/list.test.jsx` counts the reconciler's DOM mutations (a
  MutationObserver) on swap, reverse, shuffle, insert, remove, append,
  prepend, clear and replace, with owned and shared elements, fallbacks,
  multi-node rows and positional For.
- `test/events.test.jsx` covers delegation (bubbling order, `currentTarget`,
  `stopPropagation`, portals, nested roots, a closed shadow root, direct
  non-bubbling events, disposal).
- `test/template.test.js` covers compiled templates on the DOM (the same DOM
  as the runtime path, nested dynamic parts, per-document clones, the
  Host-call build, owned lists, the worker's clones) and text bindings.
- `test/root.test.jsx` runs application roots: dom and shadow roots with
  different themes on one document, duplicate ids, graph, pending, storage,
  event and lock isolation, contexts across every construct, nested roots
  (another renderer, and the default through `nest()`), a worker-runtime
  root over a MessageChannel, and disposal that leaves no globals or
  listeners.
- `test/retire.test.jsx` covers background disposal on the DOM: list
  clears, replaces and large partial removals, positional For, content swaps with
  portals and nested roots, failing cleanups, Pending, disposal mid-drain,
  and the sweep pacing.
- `test/remote.test.jsx` and `test/mailbox.test.jsx` render the same
  components direct and in worker mode (over a MessageChannel, and once in a
  worker_threads Worker) and compare the DOM after every step, with the
  shared mailbox.
- `test/style.test.jsx` covers the portable style on the DOM: ren-core's
  vocabulary written as CSS, the box model's defaults on every primitive,
  state styles as classes, and the shorthand props a style overrides.
- `test/layout.test.jsx` covers the `layout` option: each primitive at the
  box a ren-canv Document computes for the same view, changes moving only
  what moved.
- `test/flow.test.jsx` covers flow control: Sequence, Times and For's
  keying modes.
- `test/transition.test.jsx` covers no tearing: stale content stays
  visible while async work runs, and `$pending` tells a change is coming.
- `test/drag.test.jsx` covers drags: a portable primitive never starts a
  native drag, the application's HTML keeps the browser's own, and a
  pointer the browser takes back arrives as `pointercancel`.
- `test/security.test.jsx` covers what is never written: `javascript:`
  URLs in every URL attribute and their browser-parsed variants, an href a
  URL part makes one, `srcdoc`, an SVG animation's `javascript:` values,
  `on*` strings in any case on HTML, SVG and MathML elements, and the
  function handlers that stay.
- `test/viewport.test.jsx` covers `$viewport` and `$media` on the window.
- `test/development.test.jsx` covers development mode: reads in component
  bodies and row callbacks, where nothing tracks them.
- `test/state-fuzz.test.js` fuzzes state values (fixed seeds) against a CSS
  Syntax model (`test/fixtures/css-syntax.js`): every state rule reads as its
  own, and the next one whole.
- `test/timers.test.js` fails a timer call that does not say why it is one.
- `test/exports.test.js` locks the public contract to
  `test/exports.lock.json`.
- `npm test` runs the `.jsx` suites twice: with the automatic runtime
  (`ren-core/loader`) and compiled by ren-core/esbuild (`ren-core/compiled`).
- `test/types/` holds TypeScript consumers (views, roots, the worker
  runtime) compiled with `tsc --noEmit`.

## Benchmarks

The [ren-bench market suite](https://github.com/wiltonlazary/ren-bench/blob/main/bench/market/README.md)
owns the keyed table comparison, pinned competitors and current results. It
loads ren-dom and ren-core through their public package entries. The
[UI suite](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/README.md) measures worker
mode and disposal on the DOM and Skia. Run benchmark commands from ren-bench.
