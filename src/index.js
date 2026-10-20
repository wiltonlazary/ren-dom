// ren-dom: the fine-grained DOM renderer, a Host (ren-core/host) over a DOM
// document: `$dom` (light DOM) and `$shadow` (a shadow root).
//
// ren-core primitives (View, Layout, Scroll, Label, Edit, Action, Image, Shape)
// map to DOM elements with the portable properties of the ren-core view protocol;
// any other tag is an HTML (or SVG) element with DOM properties, attributes
// and events. Bindings write the DOM directly in the Render phase; there is
// no virtual DOM and no diff beyond each property's previous value.

import { mount, skeleton, Theme, COLORS, UNITLESS, focusables, argb, behaviorOf } from 'ren-core/host';

/** @typedef {import('ren-core/host').Host} Host */
/** @typedef {import('ren-core/host').Switches} Switches */

const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
/** The CSS properties (camelCase) whose number is written bare; every other number is in px. */
const UNITLESS_CSS = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth', 'columnCount', 'columns',
  'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'gridArea', 'gridColumn', 'gridColumnEnd', 'gridColumnStart', 'gridRow', 'gridRowEnd',
  'gridRowStart', 'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom',
  'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth',
  'fontSizeAdjust', 'shapeImageThreshold', 'mathDepth', 'initialLetter', 'maskBorderOutset', 'maskBorderSlice', 'maskBorderWidth',
  'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup',
]);

/** The attribute a DOM property reflects, where its name differs beyond case. */
const REFLECTED = /** @type {Record<string, string>} */ ({ className: 'class', htmlFor: 'for', acceptCharset: 'accept-charset', httpEquiv: 'http-equiv', ch: 'char', chOff: 'charoff', relList: 'rel', classList: 'class' });
/**
 * String properties whose value is not an attribute of their own name: the
 * element's content (a textarea's defaultValue is its text), or another
 * attribute (an input's defaultValue is its value attribute). null or
 * undefined empties them through the property.
 */
const CONTENT = new Set(['innerHTML', 'outerHTML', 'textContent', 'innerText', 'outerText', 'nodeValue', 'defaultValue']);

/**
 * The attributes (and the properties reflecting them) whose value is a URL a
 * browser loads, follows or submits to, in ASCII lowercase: a `javascript:`
 * one runs script there, so it is never written.
 */
const URLS = new Set(['action', 'archive', 'background', 'cite', 'classid', 'codebase', 'data', 'dynsrc', 'formaction', 'href', 'icon', 'longdesc', 'lowsrc', 'manifest', 'poster', 'profile', 'src', 'xlink:href']);
/** The values an SVG `animate` or `set` gives the attribute it names (an href too): a `javascript:` one is never written. */
const ANIMATED = new Set(['to', 'from', 'by', 'values']);
/** The URL parts of an `a` or `area`: each edits its href, which is dropped when the edit makes it a `javascript:` URL. */
const URL_PARTS = new Set(['hash', 'search', 'pathname', 'host', 'hostname', 'port', 'protocol', 'username', 'password']);
/** A name's risk (see riskOf). */
const SAFE = 0;
const LINK = 1;
const HANDLER = 2;
const SRCDOC = 3;
const ANIMATION = 4;
const URL_PART = 5;
/** Each name's risk, as met (bounded: names are the view's words, few). @type {Map<string, number>} */
const RISKS = new Map();
/**
 * What writing `name` may run: an event handler (any name starting `on`), a
 * URL, an iframe's `srcdoc` (a document of markup), an animation's value or
 * a URL part; SAFE for any other name.
 * Compared in ASCII lowercase, as an HTML element's attribute names are (a
 * Unicode fold would read the Kelvin sign as a k).
 * @param {string} name @returns {number}
 */
const riskOf = name => {
  let risk = RISKS.get(name);
  if (risk === undefined) {
    const n = name.replace(/[A-Z]+/g, c => c.toLowerCase());
    risk = n.startsWith('on') ? HANDLER : URLS.has(n) ? LINK : n === 'srcdoc' ? SRCDOC : ANIMATED.has(n) ? ANIMATION : URL_PARTS.has(name) ? URL_PART : SAFE;
    if (RISKS.size < 4096) RISKS.set(name, risk);
  }
  return risk;
};
/**
 * Whether a URL is `javascript:` as a browser's URL parser reads it: leading
 * C0 controls and spaces dropped, tabs and line breaks anywhere ignored, the
 * scheme in any ASCII case. (A character reference is the parser's: ren-dom
 * writes no markup, and ren-html escapes its `&`.) The parser drops only
 * characters up to U+0020 before the scheme, and tabs and line breaks are
 * among them, so a URL whose first character is above U+0020 and is not `j`
 * or `J` is not `javascript:`, and the common URL skips the regular
 * expressions.
 * @param {unknown} value
 */
const scripted = value => {
  const url = String(value);
  const c = url.charCodeAt(0);
  if (c > 0x20 && (c | 0x20) !== 0x6a) return false;
  return /^javascript:/i.test(url.replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, ''));
};

/** A vendor prefix of a camelCase style key (WebkitLineClamp, and CSSOM's own webkitLineClamp; MozBoxFlex, msGridRow). */
const PREFIX = /^(?:[Ww]ebkit|Moz|ms)(?=[A-Z])/;

/**
 * A style key as UNITLESS_CSS names it: camelCase, its vendor prefix gone
 * (`margin-top` and `marginTop` are `marginTop`; `WebkitLineClamp` and
 * `-webkit-line-clamp` are `lineClamp`).
 * @param {string} key
 */
const unprefixed = key => {
  const camel = key.includes('-') ? key.replace(/^-(?:webkit|moz|ms)-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : key.replace(PREFIX, '');
  return camel.charAt(0).toLowerCase() + camel.slice(1);
};

/** A style key in CSS's kebab case, as setProperty takes it (`WebkitLineClamp` is `-webkit-line-clamp`). @param {string} key */
const kebab = key => {
  if (key.includes('-')) return key;
  if (key === 'cssFloat') return 'float';
  return key.replace(PREFIX, m => `-${m.toLowerCase()}`).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
};

/**
 * A style value as CSS writes it: a number in px, but bare for a unitless
 * property (any spelling of its key) and for a custom property.
 * @param {string} key @param {any} value
 */
const cssValue = (key, value) => (typeof value === 'number' && !key.startsWith('--') && !UNITLESS_CSS.has(unprefixed(key)) ? `${value}px` : String(value));
/** The SVG elements (SVG 2, its filter and animation elements): made in the SVG namespace wherever they stand. */
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'desc', 'metadata', 'symbol', 'use', 'switch', 'image', 'foreignObject', 'view',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath', 'marker',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  'animate', 'animateMotion', 'animateTransform', 'mpath', 'set',
]);
/** The MathML elements (MathML Core, and those its parsers keep): made in the MathML namespace inside a MathML element; `math` wherever it stands. */
const MATH_TAGS = new Set([
  'math', 'maction', 'annotation', 'annotation-xml', 'menclose', 'merror', 'mfrac', 'mi', 'mmultiscripts', 'mn', 'mo',
  'mover', 'mpadded', 'mphantom', 'mprescripts', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup',
  'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover', 'none', 'semantics', 'mglyph', 'malignmark',
]);
/** MathML's text integration points: what is made inside them is HTML, but for mglyph and malignmark. */
const MATH_TEXT = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);

/**
 * The namespace an element gives what is made in it, as the HTML parser
 * reads markup: 1 inside an SVG element but a foreignObject, 2 inside a
 * MathML element but a text integration point, 0 (HTML) otherwise.
 * @param {any} parent
 */
const spaceOf = parent => {
  if (parent == null) return 0;
  const ns = parent.namespaceURI;
  if (ns === SVG) return parent.localName === 'foreignObject' ? 0 : 1;
  if (ns === MATHML) return MATH_TEXT.has(parent.localName) ? 0 : 2;
  return 0;
};

/**
 * The namespace of an element `tag` made in a parent of namespace
 * `space` (spaceOf): an SVG element is SVG and `math` MathML wherever
 * they stand; a name HTML shares with SVG (a, script, style, title) is SVG
 * inside SVG, a MathML name MathML inside MathML; anything else is HTML.
 * @param {string} tag @param {number} space
 */
const namespaceOf = (tag, space) => {
  if (SVG_TAGS.has(tag)) return SVG;
  if (tag === 'math') return MATHML;
  if (space === 1 && SHARED_TAGS.has(tag)) return SVG;
  if (space === 2 && MATH_TAGS.has(tag) && !(tag === 'mglyph' || tag === 'malignmark')) return MATHML;
  return null;
};

/**
 * Whether a template rooted at `tag` takes its namespace from where it is
 * cloned (a name HTML shares with SVG, a MathML name): its clones are cached
 * per namespace of the parent.
 * @param {string} tag
 */
const takesSpace = tag => SHARED_TAGS.has(tag) || (MATH_TAGS.has(tag) && tag !== 'math');

/**
 * A touch listener on a root or the body is passive by default in browsers,
 * where preventDefault() does nothing: touchstart and touchmove listen as
 * not passive, so a handler can keep the page from scrolling.
 * @param {string} event
 */
const activeFor = event => (event === 'touchstart' || event === 'touchmove' ? ACTIVE : undefined);
const ACTIVE = { passive: false };

/** The distinct styles a host keeps the state class of (ren-canv's caches keep as many). */
const COMPOSED = 1024;

/** A CSS property name (a custom one too): what a state rule may declare. */
const PROPERTY = /^-{0,2}[a-zA-Z][-a-zA-Z0-9]*$/;
/**
 * What could end a declaration or the rule around it in a stylesheet's text:
 * a brace, a semicolon, an angle bracket (`</style`), and every character CSS
 * reads as a newline (line feed, carriage return, form feed), which ends a
 * string early.
 */
const UNSAFE = /[{};<>\n\r\f]/;

const HEX = /^[0-9a-fA-F]$/;
/** A code point that goes on a name: a letter, a digit, `_`, `-` or anything past ASCII. */
const NAME_CHAR = /^[-\w\u0080-\uffff]$/;
/** What an unquoted url may not hold (a bad url in CSS): a quote, a parenthesis, a non-printable. */
const BAD_URL = /^["'(\u0000-\u0008\u000b\u000e-\u001f\u007f]$/;

/**
 * Whether a value closes everything it opens, read by CSS Syntax's own
 * tokenizer: after its preprocessing (CRLF, CR and form feed are all a
 * newline), no string is left open or ended by a newline, no comment opens,
 * no bracket stays open, no escape is left dangling and no unquoted url goes
 * bad. Each of these reaches past the value in a stylesheet's text. A name
 * ending in `url` before `(` is read as a url too (a tokenizer may see one
 * there, and a name that only ends in it, `rurl(` or `#url(`, is a block),
 * so its contents must hold nothing a block would read differently: no
 * quote, parenthesis, bracket, comment or inner space.
 * @param {string} raw
 */
const sealed = raw => {
  const v = raw.replace(/\r\n?|\f/g, '\n');
  const n = v.length;
  /** @type {string[]} */
  const closers = [];
  /** The name just read, escapes decoded, or '' after anything else. */
  let name = '';
  let i = 0;
  /** Reads the escape at `i` (a backslash); `-1` when it is not a valid one. */
  const escape = () => {
    if (i + 1 >= n || v[i + 1] === '\n') return -1;
    let j = i + 1;
    let hex = '';
    while (j < n && hex.length < 6 && HEX.test(v[j])) hex += v[j++];
    if (hex === '') {
      name += v[i + 1];
      return i + 2;
    }
    if (j < n && (v[j] === ' ' || v[j] === '\t' || v[j] === '\n')) j++;
    const code = parseInt(hex, 16);
    name += code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
    return j;
  };
  while (i < n) {
    const c = v[i];
    if (c === '\\') {
      i = escape();
      if (i < 0) return false;
      continue;
    }
    if (NAME_CHAR.test(c)) {
      name += c;
      i++;
      continue;
    }
    const before = name;
    name = '';
    if (c === '"' || c === "'") {
      for (i++; ; i++) {
        if (i >= n || v[i] === '\n') return false;
        if (v[i] === c) break;
        if (v[i] === '\\') {
          if (i + 1 >= n) return false;
          i++;
        }
      }
      i++;
    } else if (c === '/' && v[i + 1] === '*') return false;
    else if (c === '(' && before.toLowerCase().endsWith('url') && !/^[ \t\n]*["']/.test(v.slice(i + 1))) {
      for (i++; ; ) {
        if (i >= n) return false;
        const d = v[i];
        if (d === ')') break;
        // A bracket or a comment is nothing in a url, but a block (`rurl(`, `#url(`) would open or read it.
        if (BAD_URL.test(d) || d === '[' || d === ']' || (d === '/' && v[i + 1] === '*')) return false;
        if (d === ' ' || d === '\t' || d === '\n') {
          while (i < n && (v[i] === ' ' || v[i] === '\t' || v[i] === '\n')) i++;
          if (v[i] !== ')') return false;
          break;
        }
        if (d === '\\') {
          if (i + 1 >= n || v[i + 1] === '\n') return false;
          i += 2;
        } else i++;
      }
      i++;
    } else if (c === '(' || c === '[') {
      closers.push(c === '(' ? ')' : ']');
      i++;
    } else if (c === ')' || c === ']') {
      if (closers.pop() !== c) return false;
      i++;
    } else i++;
  }
  return closers.length === 0;
};

/** A property's family: a shorthand and its longhands, whose order decides what shows. @type {Map<string, string>} */
const families = new Map();
/** @param {string} k */
const familyOf = k => {
  let f = families.get(k);
  if (f === undefined) {
    f = k.replace(/^border-(?:top|right|bottom|left)-(width|style|color)$/, 'border-$1').replace(/^border-(?:top|bottom)-(?:left|right)-radius$/, 'border-radius').replace(/^(?:column|row)-gap$/, 'gap');
    families.set(k, f);
  }
  return f;
};
/** Each family's declarations of a set, in order, by family. @param {Record<string, string>} decls */
const familyRuns = decls => {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const k in decls) {
    const f = familyOf(k);
    out.set(f, `${out.get(f) ?? ''}${k}:${decls[k]};`);
  }
  return out;
};

/** The names both HTML and SVG have: such an element takes the namespace of the element it is written inside. */
const SHARED_TAGS = new Set(['a', 'script', 'style', 'title']);

/**
 * The bubbling events a root delegates: one listener per type at each
 * delegation root (its container, a portal's target), the handlers on the
 * nodes. Others (focus, blur, scroll, load, mouseenter, …)
 * listen on their node.
 */
const DELEGATED = new Set([
  'beforeinput', 'click', 'dblclick', 'contextmenu', 'focusin', 'focusout', 'input', 'keydown', 'keyup',
  'mousedown', 'mousemove', 'mouseout', 'mouseover', 'mouseup',
  'pointercancel', 'pointerdown', 'pointermove', 'pointerout', 'pointerover', 'pointerup', 'touchend', 'touchmove', 'touchstart',
]);

/**
 * Compiled templates by document, then plan: built once per document and
 * never handed out, only cloned (no node crosses documents or roots).
 * @type {WeakMap<object, WeakMap<object, any>>}
 */
const templates = new WeakMap();

/**
 * The cache keys of a plan's templates made for an SVG and a MathML parent
 * (its root takes the namespace of where it goes): one object each, made
 * once, shared by every document's cache.
 * @type {WeakMap<object, object[]>}
 */
const spaced = new WeakMap();
/** @param {object} plan @param {number} space */
const spacedKey = (plan, space) => {
  let keys = spaced.get(plan);
  if (keys === undefined) spaced.set(plan, (keys = [{}, {}]));
  return keys[space - 1];
};

/** Marks an Edit's element, whose children ren-core never inserts. */
const LEAF = Symbol('ren.leaf');
/** An Action's `selected`, kept to write again when its role changes. */
const SELECTED = Symbol('ren.selected');

/**
 * An Action's `selected` as `aria-pressed`, only while it has no role: a
 * role (tab, switch, option) carries its own state (aria-selected,
 * aria-checked), which the application sets.
 * @param {any} node
 */
function pressed(node) {
  const selected = node[SELECTED];
  if (selected !== undefined && !node.hasAttribute('role')) node.setAttribute('aria-pressed', selected ? 'true' : 'false');
  else if (selected !== undefined) node.removeAttribute('aria-pressed');
}

/** ren-core primitive roles and the element each one becomes. */
const PRIMITIVES = /** @type {Record<string, string>} */ ({
  View: 'div',
  Layout: 'div',
  Scroll: 'div',
  Label: 'span',
  Edit: 'input',
  Action: 'button',
  Image: 'img',
  Shape: 'svg',
});

/** An ARGB number (theme tokens) as a CSS color; strings pass through. @param {any} value */
export function color(value) {
  if (typeof value !== 'number') return value == null ? '' : String(value);
  const a = ((value >>> 24) & 255) / 255;
  return `rgba(${(value >>> 16) & 255}, ${(value >>> 8) & 255}, ${value & 255}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * A portable gradient as CSS: linear at its angle, or radial from the
 * center to the farthest corner; stops at their offsets.
 * @param {any} g
 */
function gradient(g) {
  const stops = (Array.isArray(g.stops) ? g.stops : []).map((/** @type {any} */ s) => `${color(s[1])} ${Math.round(Math.max(0, Math.min(1, s[0])) * 100000) / 1000}%`).join(', ');
  return g.radial === true ? `radial-gradient(circle farthest-corner at center, ${stops})` : `linear-gradient(${g.linear ?? 180}deg, ${stops})`;
}

/** @param {any} value */
const px = value => (typeof value === 'number' ? `${value}px` : value == null ? '' : String(value));

/**
 * The box model's defaults, written once as each primitive is made (inline,
 * so they hold without the renderer's stylesheet): border-box sizes,
 * containers as column flex boxes, Labels on one line that keeps its line
 * breaks. Every primitive is positioned (relative), so it is the containing
 * block of its absolute children and everything paints in tree order but
 * stacking contexts, as the drawn renderers place and paint them.
 * Everything else is the browser's own CSS (ren-core's style.js).
 */
const BASE = 'box-sizing:border-box;position:relative;';
const CONTAINER = `${BASE}display:flex;flex-direction:column;`;
// A field's height and an Edit's entry width are the theme's (ren-canv's
// defaults too), inline as the rest.
const FIELD = `${BASE}min-height:var(--ren-field, 38px);`;
// An Edit's text is selectable and shows the I-beam whatever its root's behavior (Safari types into no input
// that cannot be selected); its style's own cursor or select wins.
const ENTRY = 'user-select:text;-webkit-user-select:text;cursor:text;';
const BASES = /** @type {Record<string, string>} */ ({
  View: CONTAINER,
  Layout: CONTAINER,
  // Room for its bar always, as the canvases keep it (the sheet makes it the theme's `bar` wide).
  Scroll: `${CONTAINER}overflow:auto;scrollbar-gutter:stable;`,
  Label: `${BASE}display:block;white-space:pre;`,
  Edit: `${BASE}min-width:var(--ren-entry, 200px);min-height:var(--ren-field, 38px);${ENTRY}`,
  // An Action lays out what it holds as the canvases do (ren-canv lays it out
  // as a View): a column flex box, its content centered along it; a caption
  // alone centers the same way.
  Action: `${FIELD}display:flex;flex-direction:column;justify-content:center;white-space:pre;`,
  Image: BASE,
  Shape: BASE,
});

/** The portable shorthand props and the style name that overrides each. */
const SHORTHANDS = /** @type {Record<string, string>} */ ({ layout: 'direction', gap: 'gap', pad: 'padding', fill: 'background', color: 'color', size: 'fontSize', height: 'height', width: 'width', min: 'minWidth', wrap: 'wrap' });

/** The shorthand props of each primitive node, kept so a style that stops setting a field gives it back. */
const SHORT = Symbol('ren.short');
/** The portable style of a primitive node, and the CSS properties it wrote. */
const LOOK = Symbol('ren.look');
const WROTE = Symbol('ren.wrote');
/** A node's state class, as the host counts its users. */
const HELD = Symbol('ren.held');
/** The listener that tells a layout engine what is typed into an autosized Edit (the `layout` option). */
const TYPED = Symbol('ren.typed');
/** A multi-line Edit's `autosize` prop, for the heights its style does not set. */
const AUTOSIZE = Symbol('ren.autosize');
/** A multi-line Edit's top border (without a layout engine): its rows' padding follows it (see rowsPad). */
const EDGE = Symbol('ren.edge');
/** A primitive hidden by its `hidden` prop. */
const HIDE = Symbol('ren.hide');
/** A Label's line clamp (its `lines`, 0: none) and its one-line `ellipsis`. */
const CLAMP = Symbol('ren.clamp');
const ELLIPSIS = Symbol('ren.ellipsis');
/** The name a primitive's `label` gave it (its `aria-label` while the application gives none), and one the application gave. */
const LABEL = Symbol('ren.label');
const NAMED = Symbol('ren.named');
/** A primitive that hears its native drags (`onDragStart`): the drag is the application's. */
const DRAGS = Symbol('ren.drags');

/**
 * The display a primitive shows with (not hidden): a clamped Label's box,
 * else what its style wrote, else its base's.
 * @param {any} node @param {string} base
 */
function displayOf(node, base) {
  if (node[CLAMP] > 0) return '-webkit-box';
  const wrote = node[WROTE];
  if (wrote !== undefined && wrote.display !== undefined) return wrote.display;
  return defaultOf(base, 'display') ?? '';
}

/**
 * A Label's `lines` and `ellipsis`: at most that many wrapped lines, the
 * last ending with an ellipsis (the prefixed line clamp browsers take, and
 * CSS's own); or one line that ends with an ellipsis where it does not fit;
 * or neither, its wrapping as its style or `wrap` says.
 * @param {any} node @param {string} base
 */
function trim(node, base) {
  const style = node.style;
  const lines = node[CLAMP] ?? 0;
  const one = node[ELLIPSIS] === true;
  if (lines > 0) {
    style.setProperty('-webkit-box-orient', 'vertical');
    style.setProperty('-webkit-line-clamp', String(lines));
    style.setProperty('line-clamp', String(lines));
    style.whiteSpace = 'pre-wrap';
    style.overflowWrap = 'break-word';
  } else {
    style.removeProperty('-webkit-box-orient');
    style.removeProperty('-webkit-line-clamp');
    style.removeProperty('line-clamp');
    const wrap = node[LOOK]?.wrap ?? node[SHORT]?.wrap;
    style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
    style.overflowWrap = wrap ? 'break-word' : '';
  }
  style.overflow = lines > 0 || one ? 'hidden' : '';
  style.textOverflow = lines > 0 || one ? 'ellipsis' : '';
  if (node[HIDE] !== true) style.display = displayOf(node, base);
}

/**
 * The height of a multi-line Edit of `rows` rows: a field, and a line per
 * row past the first, a line its own (its font and line height, as the
 * canvases size it). @param {number} rows
 */
const rowsHigh = rows => `calc(var(--ren-field, 38px) + ${rows - 1} * 1lh)`;

/**
 * A multi-line Edit's padding-block: its first row where a one-line field's
 * text sits, less its top border `edge` (a CSS length), as the canvases pad it.
 * @param {string} edge
 */
const rowsPad = edge => `max(0px, calc((var(--ren-field, 38px) - 1lh) / 2 - ${edge}))`;

/** The top border a multi-line Edit's style writes (the last of its widths that reaches the top), else the sheet's 1px. @param {Record<string, string>} out */
function edgeOf(out) {
  let edge = '1px';
  for (const key in out) if (key === 'border-width' || key === 'border-top-width') edge = out[key];
  return edge;
}

/**
 * The heights a multi-line Edit's `autosize` sets: on, it grows with its
 * content (CSS's field-sizing) from its `rows` up to `value` rows (true: no
 * limit); off, it is its `rows` high.
 * @param {any} value @param {number} rows @returns {Record<string, string>}
 */
const heightsOf = (value, rows) =>
  value === true || (typeof value === 'number' && value > 0)
    ? { 'min-height': rowsHigh(rows), 'max-height': value === true ? '' : rowsHigh(Math.max(rows, Math.floor(value))), height: '' }
    : { 'min-height': defaultOf(BASES.Edit, 'min-height') ?? '', 'max-height': '', height: rowsHigh(rows) };

/**
 * A multi-line Edit's `autosize` (see heightsOf). A minHeight, maxHeight or
 * height its style sets wins over autosize's, whichever came first (as on the
 * canvases); the style's look hands autosize's back when it stops setting one.
 * @param {any} node @param {any} value
 */
function autosize(node, value) {
  if (node.tagName !== 'TEXTAREA') return;
  const style = node.style;
  node[AUTOSIZE] = value ?? false;
  if (value === true || (typeof value === 'number' && value > 0)) {
    style.setProperty('field-sizing', 'content');
    // It grows down only: its width is its box's, as on the canvases, not its text's.
    style.setProperty('contain', 'inline-size');
  } else {
    style.removeProperty('field-sizing');
    style.removeProperty('contain');
  }
  const own = node[WROTE];
  const heights = heightsOf(value, node.rows);
  for (const key in heights)
    if (own?.[key] === undefined) {
      if (heights[key] === '') style.removeProperty(key);
      else style.setProperty(key, heights[key]);
    }
}

/** The input types that take typed text, as a selector list. */
const TYPED_INPUTS = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].map(t => `[type="${t}" i]`).join(', ');
/** Tags whose keys are typing. */
const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Whether a key's target is a text field (`$keys`' `editable`). @param {any} t */
const field = t => t != null && (FIELDS.has(t.tagName) || t.isContentEditable === true);
/** Whether `target` is `node` or holds it, across shadow roots. @param {any} target @param {any} node */
const around = (target, node) => {
  for (let n = node; n != null; n = n.parentNode ?? n.host) if (n === target) return true;
  return false;
};

/**
 * Whose `n` is, walking out across shadow roots: 1 when it is in `top` with
 * no other root's host element between them, -1 when another root holds it
 * first (a nested one's own), 0 when no root does.
 * @param {any} n @param {any} top
 */
const whose = (n, top) => {
  for (; n != null; n = n.parentNode ?? n.host) {
    if (n === top) return 1;
    if (n.nodeType === 1 && n.hasAttribute('data-ren-root')) return -1;
  }
  return 0;
};

/**
 * The outermost element around `n`, up to `top`, whose text is opted in to
 * selection (its user-select is text, as the style `select: 'text'` writes):
 * the first met, and those around it that are too. Null when none is.
 * @param {any} n @param {any} top
 */
const optedIn = (n, top) => {
  const view = n.ownerDocument?.defaultView;
  /** @type {any} */
  let opted = null;
  for (; n != null && n !== top && n.nodeType !== 11; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const text = (view?.getComputedStyle?.(n) ?? n.style).getPropertyValue('user-select') === 'text';
    if (text) opted = n;
    else if (opted !== null) break;
  }
  return opted;
};

/**
 * What each switch of a behavior writes on the root's host element while
 * off (inline, so it holds without the sheet), and the values a nested
 * root's host element is given back while its parent's is off, so the
 * parent's cascade stops at it: [switch, off, on].
 */
const SWITCHED = /** @type {[keyof Switches, Record<string, string>, Record<string, string>][]} */ ([
  ['select', { 'user-select': 'none', '-webkit-user-select': 'none' }, { 'user-select': 'text', '-webkit-user-select': 'text' }],
  // Loose text shows no I-beam; an element with its own cursor keeps it.
  ['textCursor', { cursor: 'default' }, { cursor: 'auto' }],
  ['callout', { '-webkit-touch-callout': 'none', '-webkit-tap-highlight-color': 'transparent' }, { '-webkit-touch-callout': 'default', '-webkit-tap-highlight-color': 'initial' }],
]);

/** True for a CSS family list naming monospace (as the canvases read it). @param {string} family */
const monospaced = family => family.split(',').some(f => f.trim().replace(/^["']|["']$/g, '').toLowerCase() === 'monospace');

const ALIGN = /** @type {Record<string, string>} */ ({ start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' });
const JUSTIFY = /** @type {Record<string, string>} */ ({ start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' });
/** Style names written as a length in px, and their CSS property. */
const LENGTHS = /** @type {Record<string, string>} */ ({ gap: 'gap', columnGap: 'column-gap', rowGap: 'row-gap', width: 'width', height: 'height', minWidth: 'min-width', maxWidth: 'max-width', minHeight: 'min-height', maxHeight: 'max-height', fontSize: 'font-size' });
const container = (/** @type {string} */ role) => role === 'View' || role === 'Layout' || role === 'Scroll';

/** The box model's style names: a layout engine (the `layout` option) decides them, not CSS. */
const PLACED = new Set(['position', 'top', 'right', 'bottom', 'left', 'inset', 'display', 'columns', 'rows', 'column', 'row', 'direction', 'margin', 'gap', 'columnGap', 'rowGap', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'aspectRatio', 'grow', 'shrink', 'align', 'self', 'justify']);
/** The shorthand props of the box model, as PLACED. */
const PLACED_SHORT = new Set(['layout', 'gap', 'height', 'width', 'min']);
/** With a layout engine, every primitive sits at its box: its parent (or the view's container) is its containing block. */
const POSITIONED = 'box-sizing:border-box;position:absolute;margin:0;';
const POSITIONED_BASES = /** @type {Record<string, string>} */ ({
  View: POSITIONED,
  Layout: POSITIONED,
  Scroll: `${POSITIONED}overflow:auto;`,
  Label: `${POSITIONED}white-space:pre;`,
  Edit: `${POSITIONED}${ENTRY}`,
  Action: `${POSITIONED}white-space:pre;`,
  Image: POSITIONED,
  Shape: POSITIONED,
});

/** Each base's declarations by property, for what a style stops setting. @type {Map<string, Map<string, string>>} */
const DEFAULTS = new Map();
/** The base value of a CSS property in a primitive's base, or undefined. @param {string} base @param {string} property */
function defaultOf(base, property) {
  let map = DEFAULTS.get(base);
  if (map === undefined) {
    map = new Map();
    for (const part of base.split(';')) {
      const at = part.indexOf(':');
      if (at > 0) map.set(part.slice(0, at), part.slice(at + 1));
    }
    DEFAULTS.set(base, map);
  }
  return map.get(property);
}

/** True for a shorthand prop of the box model. @param {string} role @param {string} name */
const placed = (role, name) => PLACED_SHORT.has(name) || (name === 'wrap' && container(role));

/**
 * A style without the box model's names (the `layout` option), but
 * `display: 'contents'`: the element makes no box, so its children sit
 * against its parent's, where the engine places them.
 * @param {Record<string, any>} s @param {string} role
 */
function painted(s, role) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key in s) if ((!PLACED.has(key) || (key === 'display' && s[key] === 'contents')) && !(key === 'wrap' && container(role))) out[key] = s[key];
  return out;
}

/**
 * The CSS of a portable style (ren-core's vocabulary), as property: value
 * pairs, written straight from the object: a browser reads its colors and
 * lengths itself, so the DOM needs none of the normalizing the canvases do.
 * Names outside the vocabulary pass through as CSS.
 * @param {Record<string, any>} v @param {string} role
 * @returns {Record<string, string>}
 */
function css(v, role) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const key in v) {
    const x = v[key];
    if (x == null) continue;
    switch (key) {
      case 'display':
        // A container's only (a leaf ignores it, as on the canvases): 'contents' makes no box, its children laid out as its parent's.
        if (container(role)) out.display = x === 'grid' ? 'grid' : x === 'contents' ? 'contents' : 'flex';
        break;
      case 'textTransform':
        // An Edit shows its value as typed (as the canvases do), and a field takes no inherited transform (a browser's form controls reset it).
        if (role !== 'Edit' && (x === 'none' || x === 'uppercase' || x === 'lowercase' || x === 'capitalize')) out['text-transform'] = x;
        break;
      case 'touchAction':
        if (typeof x === 'string') out['touch-action'] = x;
        break;
      case 'scrollbarWidth':
        // A Scroll's bars as the sheet draws them (the theme's bar; half of it thin; none), and the standard word where
        // the sheet has no ::-webkit-scrollbar. Custom properties, so the sheet's look stays Blink's and WebKit's.
        if (x === 'thin' || x === 'none') {
          out['--ren-bar-size'] = x === 'thin' ? 'calc(var(--ren-bar) / 2)' : '0px';
          out['--ren-bars'] = x;
        }
        break;
      case 'scrollbarColor':
        // [thumb, track], inherited as CSS's scrollbar-color.
        if (Array.isArray(x) && x.length === 2 && argb(x[0]) !== null && argb(x[1]) !== null) {
          out['--ren-thumb'] = color(x[0]);
          out['--ren-track'] = color(x[1]);
        }
        break;
      case 'columns':
      case 'rows':
        out[`grid-template-${key}`] = Array.isArray(x) ? x.map(t => (typeof t === 'number' ? `${t}px` : String(t))).join(' ') : String(x);
        break;
      case 'column':
      case 'row':
        out[`grid-${key}`] = String(x);
        break;
      case 'direction':
        out['flex-direction'] = x === 'row' ? 'row' : 'column';
        break;
      case 'wrap':
        // A flag, as ren-core reads it for the canvases: anything else is unset.
        if (x !== true && x !== false) break;
        if (container(role)) out['flex-wrap'] = x ? 'wrap' : 'nowrap';
        else {
          // Breaking a word only where it overflows: its min-content is its longest word, as the canvases size it.
          out['white-space'] = x ? 'pre-wrap' : 'pre';
          if (x) out['overflow-wrap'] = 'break-word';
        }
        break;
      case 'padding':
      case 'margin': {
        const [t, r, b, l] = typeof x === 'number' ? [x, x, x, x] : x.length === 2 ? [x[0], x[1], x[0], x[1]] : x;
        out[`${key}-top`] = `${t}px`;
        out[`${key}-right`] = `${r}px`;
        out[`${key}-bottom`] = `${b}px`;
        out[`${key}-left`] = `${l}px`;
        break;
      }
      case 'gap':
        // The shorthand, or with a longhand set, the other one only: the longhand wins, as on the canvases, in any key order.
        if (v.columnGap == null && v.rowGap == null) out.gap = px(x);
        else if (v.columnGap == null) out['column-gap'] = px(x);
        else if (v.rowGap == null) out['row-gap'] = px(x);
        break;
      case 'grow':
        out['flex-grow'] = String(x);
        break;
      case 'shrink':
        out['flex-shrink'] = String(x);
        break;
      case 'align':
        out['align-items'] = ALIGN[x] ?? '';
        break;
      case 'self':
        out['align-self'] = ALIGN[x] ?? '';
        break;
      case 'justify':
        out['justify-content'] = JUSTIFY[x] ?? '';
        break;
      case 'overflow':
        if (role !== 'Scroll') out.overflow = x === 'hidden' ? 'hidden' : 'visible';
        break;
      case 'background':
        out.background = typeof x === 'object' ? gradient(x) : color(x);
        break;
      case 'color':
      case 'opacity':
        out[key] = key === 'opacity' ? String(x) : color(x);
        break;
      case 'border':
        out['border-width'] = `${x}px`;
        out['border-style'] = v.borderStyle ?? 'solid';
        break;
      case 'borderTop':
      case 'borderRight':
      case 'borderBottom':
      case 'borderLeft': {
        // One side: its width and the style, so the other sides keep none.
        const side = key.slice(6).toLowerCase();
        out[`border-${side}-width`] = `${x}px`;
        out[`border-${side}-style`] = v.borderStyle ?? 'solid';
        break;
      }
      case 'borderTopColor':
      case 'borderRightColor':
      case 'borderBottomColor':
      case 'borderLeftColor':
        out[`border-${key.slice(6, -5).toLowerCase()}-color`] = color(x);
        break;
      case 'borderStyle':
        // With `border` (all sides); a side's own width writes its style.
        if (v.border != null) out['border-style'] = String(x);
        break;
      case 'borderColor':
        out['border-color'] = color(x);
        break;
      case 'radius':
        // One radius, or the four corners from the top-left, as border-radius lists them.
        out['border-radius'] = Array.isArray(x) ? x.map(px).join(' ') : px(x);
        break;
      case 'placeholderColor':
        // Inline CSS cannot reach ::placeholder: the sheet's rule reads this (inherited, as the canvases inherit it).
        out['--ren-placeholder'] = color(x);
        break;
      case 'shadow':
        out['box-shadow'] = `${x.x ?? 0}px ${x.y ?? 0}px ${x.blur ?? 0}px ${color(x.color ?? 0x40000000)}`;
        break;
      case 'fontWeight':
        // 100 to 900 as given (the browser picks the nearest face).
        out['font-weight'] = x === 'bold' ? '700' : x === 'normal' ? '400' : String(Math.max(100, Math.min(900, Math.round(Number(x) / 100) * 100)));
        break;
      case 'fontFamily':
        // A family naming monospace takes the root's monospace face where one was given (the `mono` option).
        out['font-family'] = monospaced(String(x)) ? `var(--ren-mono, ${x})` : String(x);
        break;
      case 'italic':
        out['font-style'] = x ? 'italic' : 'normal';
        break;
      case 'textAlign':
        out['text-align'] = x;
        break;
      case 'lineHeight':
        out['line-height'] = String(x);
        break;
      case 'underline':
      case 'strike':
        // One decoration line list: under and through.
        out['text-decoration'] = [v.underline === true ? 'underline' : '', v.strike === true ? 'line-through' : ''].filter(d => d !== '').join(' ') || 'none';
        break;
      case 'select':
        out['user-select'] = x === 'none' ? 'none' : 'text';
        out['-webkit-user-select'] = out['user-select'];
        // Opted-in text shows the I-beam over it, under a root whose loose text shows none, unless the style sets a cursor;
        // inside an element whose style set one (a press target's hand), that one.
        if (x !== 'none' && v.cursor == null) out.cursor = 'var(--ren-cursor, auto)';
        break;
      case 'cursor':
        // Its own, and handed down to the opted-in text inside (CSS's cursor is inherited, but that text sets its own).
        out.cursor = String(x);
        out['--ren-cursor'] = String(x);
        break;
      case 'position':
        if (x === 'absolute' || x === 'relative' || x === 'sticky' || x === 'fixed') out.position = x;
        break;
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
        out[key] = px(x);
        break;
      case 'inset':
        out.top = out.right = out.bottom = out.left = px(x);
        break;
      case 'zIndex':
        out['z-index'] = String(x);
        break;
      case 'aspectRatio':
        out['aspect-ratio'] = String(x);
        break;
      // Transforms: CSS's own properties, applied translate, rotate, then scale.
      case 'scale':
        out.scale = Array.isArray(x) ? `${x[0]} ${x[1]}` : String(x);
        break;
      case 'rotate':
        out.rotate = `${x}deg`;
        break;
      case 'skewX':
      case 'skewY':
        // CSS's transform, applied after translate, rotate and scale (as the canvases skew).
        out.transform = `skew(${v.skewX ?? 0}deg, ${v.skewY ?? 0}deg)`;
        break;
      case 'translate':
        if (Array.isArray(x)) out.translate = `${px(x[0])} ${px(x[1])}`;
        break;
      case 'transformOrigin':
        if (Array.isArray(x)) out['transform-origin'] = `${px(x[0])} ${px(x[1])}`;
        break;
      case 'hover':
      case 'press':
      case 'focus':
      case 'ring':
        break;
      default:
        if (LENGTHS[key] !== undefined) out[LENGTHS[key]] = px(x);
        else out[kebab(key)] = cssValue(key, x);
    }
  }
  return out;
}

/**
 * Applies an ren-core primitive property; false when the name is not a portable one.
 * @param {any} node @param {string} role @param {string} name @param {any} value
 */
function primitive(node, role, name, value) {
  const style = node.style;
  const field = SHORTHANDS[name];
  if (field !== undefined) {
    (node[SHORT] ??= {})[name] = value;
    // The style overrides the shorthand when it sets the same field (layout's two, each by itself).
    const look = node[LOOK];
    if (name !== 'layout' && look != null && look[field] != null) return true;
  }
  switch (name) {
    case 'text':
      if (role === 'Label' || role === 'Action') node.textContent = value == null ? '' : String(value);
      else return false;
      return true;
    case 'runs':
      if (role !== 'Label') return false;
      runs(node, value);
      return true;
    case 'value':
      if (role !== 'Edit') return false;
      if (node.value !== String(value ?? '')) node.value = String(value ?? '');
      return true;
    case 'label': {
      const text = value == null ? '' : String(value);
      if (role === 'Edit') node.placeholder = text;
      // It names the element unless the application named it (`aria-label`):
      // an explicit name wins over a placeholder that changes. A cloned
      // template keeps attributes, not the marks: a name that is not the
      // label's is the application's.
      const now = node.getAttribute('aria-label');
      if (node[NAMED] !== true && (now === null || now === (node[LABEL] ?? null))) node.setAttribute('aria-label', text);
      node[LABEL] = text;
      return true;
    }
    case 'layout': {
      // Its direction unless the style's; a row laid out by the shorthand wraps its children unless the style's wrap says.
      const look = node[LOOK];
      if (look?.direction == null) style.flexDirection = value === 'row' ? 'row' : 'column';
      if (look?.wrap == null) style.flexWrap = value === 'row' ? 'wrap' : 'nowrap';
      return true;
    }
    case 'gap': {
      // The shorthand, or, where the style sets a longhand, the other one only: a gap shorthand
      // written after a columnGap would reset it in a browser, where the canvases let the longhand win.
      const look = node[LOOK];
      if (look?.columnGap == null && look?.rowGap == null) style.gap = px(value);
      else if (look.columnGap == null) style.columnGap = px(value);
      else if (look.rowGap == null) style.rowGap = px(value);
      return true;
    }
    case 'pad':
      style.padding = px(value);
      // A multi-line Edit's rows take their padding-block back.
      if (value == null && node[EDGE] !== undefined) style.paddingBlock = rowsPad(node[EDGE]);
      return true;
    case 'fill':
      style.background = color(value);
      return true;
    case 'color':
      style.color = color(value);
      return true;
    case 'size':
      style.fontSize = px(value);
      return true;
    case 'height':
      style.height = px(value);
      return true;
    case 'width':
      style.width = px(value);
      return true;
    case 'min':
      style.minWidth = px(value);
      return true;
    case 'selected':
      // Given (true or false): a toggle. null or undefined: not one, with no aria-pressed.
      if (value == null) {
        if (node[SELECTED] !== undefined) node.removeAttribute('aria-pressed');
        node[SELECTED] = undefined;
      } else {
        node[SELECTED] = !!value;
        pressed(node);
      }
      return true;
    case 'wrap':
      if (container(role)) style.flexWrap = value ? 'wrap' : 'nowrap';
      else {
        style.whiteSpace = value ? 'pre-wrap' : 'pre';
        style.overflowWrap = value ? 'break-word' : '';
      }
      return true;
    case 'source':
      if (role !== 'Image') return false;
      node.src = value == null ? '' : String(value);
      return true;
    case 'invalid':
      node.setAttribute('aria-invalid', value ? 'true' : 'false');
      return true;
    case 'secret':
      // A password field; a multi-line Edit (a textarea) has none.
      if (role !== 'Edit') return false;
      if (node.tagName === 'INPUT') node.type = value ? 'password' : 'text';
      return true;
    case 'inert':
      // A region that takes no part in input: the browser keeps focus, pointer, selection and the accessibility tree from it.
      if (value) node.setAttribute('inert', '');
      else node.removeAttribute('inert');
      return true;
    case 'tabIndex': {
      // Its place in the focus: set, a container takes it; -1 keeps it out of the Tab order.
      const index = typeof value === 'number' || typeof value === 'string' ? Math.trunc(Number(value)) : NaN;
      if (Number.isFinite(index)) node.setAttribute('tabindex', String(index));
      else node.removeAttribute('tabindex');
      return true;
    }
    case 'trap':
      // A focus trap: Tab cycles inside it while the focus is inside.
      if (node[TRAP] === undefined) {
        node.addEventListener('keydown', trapped);
        traps++;
      }
      node[TRAP] = !!value;
      return true;
    case 'axis':
      // A Scroll's axis: across, down (clipping across, as the canvases) or both; unset, the base's overflow.
      if (role !== 'Scroll') return false;
      style.overflowX = value === 'x' || value === 'both' ? 'auto' : value === 'y' ? 'hidden' : '';
      style.overflowY = value === 'y' || value === 'both' ? 'auto' : value === 'x' ? 'hidden' : '';
      if (value == null) style.overflow = 'auto';
      // Across only: no room at its side (the canvases keep a bar along its bottom).
      style.setProperty('scrollbar-gutter', value === 'x' ? 'auto' : 'stable');
      return true;
    case 'shapes':
      if (role !== 'Shape') return false;
      shapes(node, value ?? []);
      return true;
    default:
      return false;
  }
}

/**
 * A Label's `runs`: a span per run, its style the run's (the text part of
 * the vocabulary, as CSS), inheriting the Label's; its `onPress` a click
 * on the span, before the Label's. The Label's text is the spans' text.
 * @param {any} node @param {any} value
 */
function runs(node, value) {
  node.textContent = '';
  if (!Array.isArray(value)) return;
  const doc = node.ownerDocument;
  for (const run of value) {
    if (run == null) continue;
    const span = doc.createElement('span');
    span.textContent = run.text == null ? '' : String(run.text);
    const s = run.style;
    if (s != null && typeof s === 'object') {
      const out = css(s, 'Label');
      for (const key in out) span.style.setProperty(key, out[key]);
    }
    if (typeof run.onPress === 'function') span.addEventListener('click', run.onPress);
    node.appendChild(span);
  }
}

/**
 * The standard `scrollbar-width` nearest a theme's bar width: none, thin
 * (about 8 px in Firefox) up to 10 px, else the platform's own.
 * @param {number} width
 */
const scrollbar = width => (!(width > 0) ? 'none' : width <= 10 ? 'thin' : 'auto');

/** The text properties a field's wrapping depends on, copied to the mirror that measures its rows. */
const ROWS_TEXT = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'font-kerning', 'font-feature-settings', 'font-variation-settings', 'letter-spacing', 'word-spacing', 'line-height', 'tab-size', 'text-indent', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'padding-left', 'padding-right'];

/**
 * An Edit's `caretRow()`: the drawn row its caret is in and how many rows
 * it draws, `{ row, rows }` from 0, as the canvases' Edit gives them. A
 * one-line Edit's is row 0 of 1. A multi-line Edit's are measured in a
 * hidden copy of the field as a textarea wraps (its font, spacing and
 * width, pre-wrap): its value up to the caret, then the rest in a span, so
 * the span starts on the caret's row (at a wrap, the next row's start, as
 * the caret shows after a move there), and the rows are the copy's height
 * in lines. With no layout (no document, a DOM without one) it counts the
 * value's own lines.
 * @this {any}
 * @returns {{ row: number, rows: number }}
 */
function caretRow() {
  const node = this;
  if (node.tagName !== 'TEXTAREA') return { row: 0, rows: 1 };
  const value = String(node.value);
  const end = node.selectionDirection === 'backward' ? node.selectionStart : node.selectionEnd;
  const at = typeof end === 'number' ? Math.min(Math.max(0, end), value.length) : value.length;
  const doc = node.ownerDocument;
  const view = doc?.defaultView;
  const computed = node.isConnected ? view?.getComputedStyle?.(node) : undefined;
  if (computed != null && node.clientWidth > 0) {
    const copy = doc.createElement('div');
    const style = copy.style;
    for (const name of ROWS_TEXT) style.setProperty(name, computed.getPropertyValue(name));
    style.setProperty('position', 'absolute');
    style.setProperty('visibility', 'hidden');
    style.setProperty('left', '0');
    style.setProperty('top', '0');
    style.setProperty('box-sizing', 'border-box');
    style.setProperty('border', '0');
    style.setProperty('padding-top', '0');
    style.setProperty('padding-bottom', '0');
    style.setProperty('white-space', 'pre-wrap');
    // The field's text box: its client width (inside its border, less a bar), its paddings within it.
    style.setProperty('width', `${node.clientWidth}px`);
    const rest = doc.createElement('span');
    // The rest of the value and a zero-width space: the field's last row after a final line break holds the caret.
    rest.textContent = `${value.slice(at)}\u200b`;
    copy.append(value.slice(0, at), rest);
    (doc.body ?? doc.documentElement).appendChild(copy);
    try {
      const box = copy.getBoundingClientRect();
      const probe = doc.createElement('span');
      probe.textContent = '\u200b';
      const line = doc.createElement('div');
      line.style.cssText = style.cssText;
      line.style.setProperty('width', 'auto');
      line.appendChild(probe);
      copy.after(line);
      const lineHeight = line.getBoundingClientRect().height;
      line.remove();
      const first = rest.getClientRects()[0];
      if (lineHeight > 0 && first !== undefined) {
        const rows = Math.max(1, Math.round(box.height / lineHeight));
        // The middle of the span's first box, which its line centers.
        const row = Math.floor((first.top + first.height / 2 - box.top) / lineHeight);
        return { row: Math.min(rows - 1, Math.max(0, row)), rows };
      }
    } finally {
      copy.remove();
    }
  }
  let row = 0;
  for (let i = value.indexOf('\n'); i >= 0 && i < at; i = value.indexOf('\n', i + 1)) row++;
  let rows = 1;
  for (let i = value.indexOf('\n'); i >= 0; i = value.indexOf('\n', i + 1)) rows++;
  return { row, rows };
}

/** An Edit's styled mirror (its `runs`), on its field. */
const MIRROR = Symbol('ren.mirror');
/** A select's value set before the option it names was inserted, kept until one is or the user picks one. */
const CHOSEN = Symbol('ren.chosen');

/**
 * The select an option inserted into `parent` belongs to (in it or in an
 * optgroup of it), or null.
 * @param {any} parent
 */
const selectOf = parent => (parent.localName === 'select' ? parent : parent.localName === 'optgroup' && parent.parentNode?.localName === 'select' ? parent.parentNode : null);

/**
 * A select takes the value it keeps (CHOSEN) once an option names it; till
 * then it keeps what the browser chose (its first option, or the one it had),
 * as a browser's select does when an option comes in.
 * @param {any} select
 */
const choose = select => {
  if (select === null || select[CHOSEN] === undefined) return;
  const had = select.selectedIndex;
  select.value = select[CHOSEN];
  // Chosen once an option holds it ('' is a select's value with none selected too, so the index says).
  if (select.selectedIndex >= 0 && select.value === select[CHOSEN]) delete select[CHOSEN];
  else if (select.selectedIndex !== had) select.selectedIndex = had;
};
/** The user's pick replaces the value a select kept for a later option. @this {any} */
function unchoose() {
  delete this[CHOSEN];
}
/** The input types whose value is their value attribute (the HTML standard's default and default/on modes). */
const ATTRIBUTE_VALUED = new Set(['checkbox', 'radio', 'hidden', 'submit', 'reset', 'button', 'image']);
/** Hosts without a root id that named state classes or mirrors, counted by document (their names). @type {WeakMap<object, number>} */
const hosts = new WeakMap();

/** The field's computed style its mirror copies: what sets its text, and where. */
const COPIED = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings', 'font-kerning',
  'letter-spacing', 'word-spacing', 'line-height', 'text-align', 'text-indent', 'text-transform', 'text-rendering', 'direction', 'tab-size', 'color',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'z-index', 'opacity', 'visibility',
];
/**
 * Which of a font's faces keep its regular advances (a monospace font's all
 * do), by size and family: 1 bold, 2 italic. Bounded, the least recently
 * used going first: a size that changes on every frame makes a new font
 * each time.
 * @type {Map<string, number>}
 */
const advances = new Map();
/** The fonts `advances` keeps. */
const ADVANCES = 64;
/** Bold and italic faces both keep a font's advances. */
const FACES = 3;

/**
 * Which faces of a field's font are as wide as its regular text (1 bold,
 * 2 italic; bold italic counts for italic once bold keeps), so a mirror
 * may draw a run in them without moving the text after it off the field's
 * caret; measured once per font (on a canvas; all where there is none to
 * measure with).
 * @param {any} doc @param {any} cs the field's computed style
 * @returns {number}
 */
function keeps(doc, cs) {
  const family = cs.fontFamily;
  const size = cs.fontSize;
  if (!family || !size) return FACES;
  const key = `${size} ${family}`;
  const known = advances.get(key);
  if (known !== undefined) {
    advances.delete(key);
    advances.set(key, known);
    return known;
  }
  /** @type {any} */
  let context = null;
  try {
    context = doc.createElement('canvas').getContext('2d');
  } catch {}
  if (context == null || typeof context.measureText !== 'function') return FACES;
  /** @param {string} face */
  const width = face => {
    context.font = `${face} ${size} ${family}`;
    return context.measureText('iilWWm 0.,;').width;
  };
  const base = width('normal 400');
  /** @param {number} w */
  const same = w => Math.abs(w - base) <= 0.01;
  const bold = same(width('normal 700'));
  const italic = same(width('italic 400')) && (!bold || same(width('italic 700')));
  const faces = (bold ? 1 : 0) | (italic ? 2 : 0);
  // A web font still loading measures as its fallback: measured again later.
  if (doc.fonts?.status !== 'loading') {
    if (advances.size >= ADVANCES) advances.delete(/** @type {string} */ (advances.keys().next().value));
    advances.set(key, faces);
  }
  return faces;
}

/**
 * A weight drawn in the field's regular face, as a browser synthesizes a
 * bold its font lacks: a stroke around the glyphs, which paints and moves
 * nothing (1/24 of the size at 700, as Skia's fake bold at text sizes;
 * none at 400 or lighter).
 * @param {string} weight a computed font-weight
 */
function stroke(weight) {
  const w = weight === 'bold' || weight === 'bolder' ? 700 : Number.parseFloat(weight);
  if (!(w > 400)) return '';
  return `${Math.round((Math.min(w, 900) - 400) / 300 / 24 * 10000) / 10000}em`;
}

/** The field's background properties a run's background layers go in front of. */
const LAYERED = ['background-image', 'background-position', 'background-size', 'background-repeat', 'background-origin', 'background-clip'];

/** A CSS list split at its top-level commas (none when empty: a style not computed). @param {string} value */
function layers(value) {
  /** @type {string[]} */
  const out = [];
  if (value.trim() === '') return out;
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 40) depth++;
    else if (c === 41) depth--;
    else if (c === 44 && depth === 0) {
      out.push(value.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(value.slice(from).trim());
  return out;
}

/** A multi-line field's wrapping, which its mirror's text copies. */
const WRAPPING = ['white-space', 'overflow-wrap', 'word-break'];

/**
 * An Edit's `runs` on the DOM. A field cannot style its own text, so the
 * runs are drawn by a mirror: a box of the field's border box (CSS anchor
 * positioning; measured offsets where the browser has none), right after
 * the field in its parent, with the field's font, padding, borders and
 * wrapping and a span per run, scrolled as the field is, over the field and
 * hearing no pointer. The field's own text is transparent (its caret,
 * selection, IME, undo and clipboard stay native) while the runs' text is
 * its value; otherwise (a draft the view has not answered, a composition, a
 * password, an empty value) the mirror hides and the field shows its text.
 * A run's background is not the mirror's (over the field it would hide the
 * caret and the selection): it is a layer of the field's own background,
 * in front of the field's layers, at the run's boxes measured in the
 * mirror, so the caret and the selection paint over it.
 */
/**
 * The mirrors kept hidden until their fields are in a document that styles
 * them (built out of it), held weakly. They sync when their field is laid
 * out (its ResizeObserver), when a host inserts into the document, and at
 * the end of the job that built them (a Root puts its host element in its
 * target after the build, in a document or a shadow root alike).
 * @type {Set<WeakRef<Mirror>>}
 */
const waiting = new Set();

/** Syncs the waiting mirrors whose fields are in the document now, and lets go of those collected. */
function wake() {
  for (const ref of waiting) {
    const m = ref.deref();
    if (m === undefined) waiting.delete(ref);
    else if (m.node.isConnected) {
      waiting.delete(ref);
      m.waits = false;
      m.sync();
    }
  }
}

/** Keeps `mirror` hidden until its field is in the document, looking again once this job ends. @param {Mirror} mirror */
function wait(mirror) {
  mirror.waits = true;
  waiting.add(new WeakRef(mirror));
  queueMicrotask(wake);
}

/** Lets go of the mirrors a closed host made that still wait. @param {object} owner */
function forget(owner) {
  for (const ref of waiting) {
    const m = ref.deref();
    if (m === undefined || m.owner === owner) waiting.delete(ref);
  }
}

class Mirror {
  /** @param {any} node the field @param {string} name its anchor's name @param {object} [owner] its host, which lets it go on close */
  constructor(node, name, owner = {}) {
    const doc = node.ownerDocument;
    this.node = node;
    this.owner = owner;
    /** In `waiting`, its field not yet styled. */
    this.waits = false;
    this.multi = node.tagName === 'TEXTAREA';
    /** @type {any[] | null} */
    this.runs = null;
    /** Their texts joined, and the runs the spans show. */
    this.joined = '';
    /** @type {any[] | null} */
    this.drawn = null;
    this.on = false;
    this.composing = false;
    /** The faces the spans draw in (`keeps`); a weight the font would widen is a stroke. */
    this.faces = FACES;
    /** The spans with a background, and its image as a layer. @type {any[]} */
    this.marks = [];
    /** The field's own background properties, as its inline style had them before the runs' layers (null: none written). @type {string[] | null} */
    this.saved = null;
    /** What the layers wrote (read back; empty: none written). @type {string[]} */
    this.wrote = [];
    /** The field's own layers, behind the runs' (its computed lists, each as long as its images). @type {string[][]} */
    this.base = [];
    this.anchored = doc.defaultView?.CSS?.supports?.('anchor-name: --a') === true;
    const box = (this.box = doc.createElement('div'));
    const text = (this.text = doc.createElement('div'));
    box.setAttribute('data-ren-mirror', '');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText =
      'position:absolute;box-sizing:border-box;margin:0;border-style:solid;border-color:transparent;background:none;' +
      `pointer-events:none;user-select:none;overflow:hidden;display:none;align-items:center;position-anchor:${name};` +
      'top:anchor(top);left:anchor(left);width:anchor-size(width);height:anchor-size(height);';
    text.style.cssText = this.multi ? 'white-space:pre-wrap;overflow-wrap:break-word;' : 'white-space:pre;flex:none;min-width:100%;';
    box.appendChild(text);
    node.style.setProperty('anchor-name', name);
    const sync = () => this.sync();
    for (const type of ['input', 'focus', 'blur']) node.addEventListener(type, sync);
    node.addEventListener('scroll', () => this.scroll());
    node.addEventListener('compositionstart', () => {
      this.composing = true;
      this.sync();
    });
    node.addEventListener('compositionend', () => {
      this.composing = false;
      this.sync();
    });
  }

  /** New runs (null: none). @param {any} value */
  set(value) {
    this.runs = Array.isArray(value) ? value : null;
    let joined = '';
    if (this.runs !== null) for (const run of this.runs) if (run != null && run.text != null) joined += String(run.text);
    this.joined = joined;
    this.drawn = null;
    this.sync();
  }

  /** Shows the runs while they are the field's value, beside the field; else the field's own text. */
  sync() {
    const node = this.node;
    const box = this.box;
    const parent = node.parentNode;
    if (parent != null && node.nextSibling !== box) parent.insertBefore(box, node.nextSibling);
    const value = node.value ?? '';
    const cs = node.ownerDocument.defaultView?.getComputedStyle?.(node) ?? null;
    // A field its document computes nothing for yet (built out of the document): the mirror stays hidden,
    // the field's own text showing, until it can copy the field's font (its ResizeObserver syncs it then).
    const unstyled = cs !== null && cs.getPropertyValue('font-size') === '';
    const on = this.runs !== null && !this.composing && node.type !== 'password' && node[HIDE] !== true && value !== '' && this.joined === value && !unstyled;
    if (unstyled && this.runs !== null && !this.waits) wait(this);
    if (!on) {
      if (this.on) {
        this.on = false;
        node.removeAttribute('data-ren-runs');
        node.style.removeProperty('-webkit-text-fill-color');
        box.style.display = 'none';
        this.unlayer();
      }
      return;
    }
    // The field's own background as its style sets it now, under the layers made below.
    this.unlayer();
    const faces = cs === null ? FACES : keeps(node.ownerDocument, cs);
    if (this.drawn !== this.runs || this.faces !== faces) this.draw(faces);
    if (!this.on) {
      this.on = true;
      node.setAttribute('data-ren-runs', '');
      node.style.setProperty('-webkit-text-fill-color', 'transparent');
      box.style.display = this.multi ? 'block' : 'flex';
    }
    if (cs !== null) this.copy(cs);
    if (this.marks.length > 0 && cs !== null) {
      const base = LAYERED.map(key => layers(cs.getPropertyValue(key)));
      // Each list as long as the images, as the browser repeats a shorter one.
      const n = base[0].length;
      this.base = base.map(list => (list.length === n ? list : Array.from({ length: n }, (_, i) => list[i % list.length])));
      this.saved = LAYERED.map(key => node.style.getPropertyValue(key));
    }
    this.scroll();
  }

  /**
   * A span per run, in the run's style: its size and family stay the
   * field's; a weight the field's font would widen (a proportional font)
   * is drawn as a stroke in its regular face, and an italic it would widen
   * is left out, so the text stays under the caret; a background becomes a
   * layer of the field's (`layer`).
   * @param {number} faces
   */
  draw(faces) {
    const text = this.text;
    const doc = text.ownerDocument;
    const runs = /** @type {any[]} */ (this.runs);
    text.textContent = '';
    this.marks = [];
    for (const run of runs) {
      if (run == null) continue;
      const span = doc.createElement('span');
      span.textContent = run.text == null ? '' : String(run.text);
      const s = run.style;
      if (s != null && typeof s === 'object') {
        const out = css(s, 'Label');
        for (const key in out) {
          const v = out[key];
          if (key === 'font-size' || key === 'font-family') continue;
          if (key === 'background') {
            if (v !== '' && v !== 'transparent') this.marks.push(span, /gradient\(/.test(v) ? v : `linear-gradient(${v}, ${v})`);
          } else if (key === 'font-weight' && (faces & 1) === 0) {
            const width = stroke(v);
            if (width !== '') span.style.setProperty('-webkit-text-stroke', `${width} currentcolor`);
          } else if (key !== 'font-style' || (faces & 2) !== 0) span.style.setProperty(key, v);
        }
      }
      text.appendChild(span);
    }
    this.drawn = runs;
    this.faces = faces;
  }

  /**
   * The runs' backgrounds as the field's first background layers, one per
   * box of each span (a line of a wrapped run), measured in the mirror
   * against the field's border box (so scrolled as its text), clipped to
   * its padding box; the field's own layers stay behind them, and its
   * color under all.
   */
  layer() {
    const node = this.node;
    const marks = this.marks;
    if (marks.length === 0 || this.saved === null || this.base.length === 0) return;
    const f = node.getBoundingClientRect();
    // Measured in the page's pixels, placed in the field's (a scale around it).
    const sx = node.offsetWidth > 0 && f.width > 0 ? f.width / node.offsetWidth : 1;
    const sy = node.offsetHeight > 0 && f.height > 0 ? f.height / node.offsetHeight : 1;
    /** @type {string[][]} */
    const out = [[], [], [], [], [], []];
    for (let i = 0; i < marks.length; i += 2) {
      for (const r of marks[i].getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        out[0].push(marks[i + 1]);
        out[1].push(`${(r.left - f.left) / sx}px ${(r.top - f.top) / sy}px`);
        out[2].push(`${r.width / sx}px ${r.height / sy}px`);
        out[3].push('no-repeat');
        out[4].push('border-box');
        out[5].push('padding-box');
      }
    }
    const style = node.style;
    // Nothing laid out (a hidden field): its own background alone.
    if (out[0].length === 0) {
      this.restore();
      return;
    }
    const wrote = [];
    for (let k = 0; k < LAYERED.length; k++) {
      const value = [...out[k], ...this.base[k]].join(', ');
      style.setProperty(LAYERED[k], value);
      wrote.push(style.getPropertyValue(LAYERED[k]));
    }
    this.wrote = wrote;
  }

  /**
   * Gives the field its own background properties back (as its style set
   * them inline, if it did); a property the view rewrote since the layers
   * were written is the view's and stays.
   */
  unlayer() {
    this.restore();
    this.saved = null;
  }

  /** Writes the field's own background properties back over the layers, keeping them to layer again. */
  restore() {
    const saved = this.saved;
    const wrote = this.wrote;
    if (saved === null || wrote.length === 0) return;
    this.wrote = [];
    const style = this.node.style;
    for (let k = 0; k < LAYERED.length; k++) {
      // A property the view wrote since is the field's own now.
      if (style.getPropertyValue(LAYERED[k]) !== wrote[k]) continue;
      if (saved[k] === '') style.removeProperty(LAYERED[k]);
      else style.setProperty(LAYERED[k], saved[k]);
    }
  }

  /** The field's text setting and box, as the browser computes them now. @param {any} cs its computed style */
  copy(cs) {
    const node = this.node;
    const style = this.box.style;
    // A field out of the document computes nothing: the mirror keeps what it has.
    for (const key of COPIED) {
      const v = cs.getPropertyValue(key);
      if (v !== '') style.setProperty(key, v);
    }
    if (this.multi) {
      const text = this.text.style;
      for (const key of WRAPPING) {
        const v = cs.getPropertyValue(key);
        if (v !== '') text.setProperty(key, v);
      }
      // Its content width: less a scrollbar, as the field wraps.
      const width = (node.clientWidth ?? 0) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      text.width = width > 0 ? `${width}px` : '';
    }
    if (!this.anchored && typeof node.offsetWidth === 'number') {
      style.left = `${node.offsetLeft}px`;
      style.top = `${node.offsetTop}px`;
      style.width = `${node.offsetWidth}px`;
      style.height = `${node.offsetHeight}px`;
    }
  }

  /** The text scrolled as the field's. */
  scroll() {
    const node = this.node;
    const x = node.scrollLeft || 0;
    const y = node.scrollTop || 0;
    this.text.style.transform = x !== 0 || y !== 0 ? `translate(${-x}px, ${-y}px)` : '';
    if (this.on) this.layer();
  }
}

/** A primitive's focus trap (its `trap`). */
const TRAP = Symbol('ren.trap');

/** How many elements were ever made traps: none, and a removal checks no focus. */
let traps = 0;

/**
 * The focus trap a removal takes the focus from: the nearest trap around
 * `parent` when `child` is or holds the focused element, else null.
 * @param {any} parent @param {any} child
 */
function trapAround(parent, child) {
  const active = parent.getRootNode?.().activeElement;
  if (active == null || !(child === active || child.contains?.(active))) return null;
  for (let n = parent; n != null; n = n.parentNode) if (n[TRAP] === true) return n;
  return null;
}

/**
 * The focus goes back into a trap whose focused element was removed: its
 * first focusable, else the trap itself when it takes the focus (a
 * `tabindex`), as the canvases do; unless something focused another
 * element meanwhile.
 * @param {any} trap
 */
function refocus(trap) {
  if (!trap.isConnected) return;
  // The document's: a shadow root's is null while the focus is anywhere outside it.
  const doc = trap.ownerDocument;
  const active = doc.activeElement;
  if (active != null && active !== doc.body && active !== doc.documentElement) return;
  const first = focusables(trap)[0];
  if (first !== undefined) first.focus();
  else if (trap.hasAttribute('tabindex')) trap.focus();
}

/**
 * Tab inside a trap: from its last focusable to its first, Shift+Tab from
 * the first to the last, as the canvases keep Tab inside a `trap`.
 * @param {any} e
 */
function trapped(e) {
  const node = e.currentTarget;
  if (e.key !== 'Tab' || e.defaultPrevented || node[TRAP] !== true) return;
  // What Tab reaches inside it (ren-core's `$focus` focuses the first or last of them).
  const list = focusables(node);
  if (list.length === 0) return;
  const active = node.getRootNode?.().activeElement ?? node.ownerDocument?.activeElement;
  const at = list.indexOf(active);
  const next = e.shiftKey ? (at <= 0 ? list.length - 1 : -1) : at < 0 || at === list.length - 1 ? 0 : -1;
  if (next < 0) return;
  e.preventDefault();
  list[next].focus();
}

/** Gradients made for Shape fills: their ids are unique in the page. */
let fills = 0;

/**
 * A figure's gradient `fill` as an SVG gradient in user space over its
 * bounds, as the canvases lay it (linear along CSS's gradient line at its
 * angle, radial from the center to the farthest corner); returns its id.
 * @param {any} doc @param {any} defs @param {any} g @param {number} x @param {number} y @param {number} right @param {number} bottom
 */
function shade(doc, defs, g, x, y, right, bottom) {
  const radial = g.radial === true;
  const el = doc.createElementNS(SVG, radial ? 'radialGradient' : 'linearGradient');
  const id = `ren-fill-${++fills}`;
  el.setAttribute('id', id);
  el.setAttribute('gradientUnits', 'userSpaceOnUse');
  const cx = (x + right) / 2;
  const cy = (y + bottom) / 2;
  const w = right - x;
  const h = bottom - y;
  if (radial) {
    el.setAttribute('cx', cx);
    el.setAttribute('cy', cy);
    el.setAttribute('r', Math.sqrt(w * w + h * h) / 2);
  } else {
    const a = ((g.linear ?? 180) * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    el.setAttribute('x1', cx - dx * half);
    el.setAttribute('y1', cy - dy * half);
    el.setAttribute('x2', cx + dx * half);
    el.setAttribute('y2', cy + dy * half);
  }
  for (const stop of Array.isArray(g.stops) ? g.stops : []) {
    const s = doc.createElementNS(SVG, 'stop');
    s.setAttribute('offset', String(Math.max(0, Math.min(1, stop[0]))));
    s.setAttribute('stop-color', color(stop[1]));
    el.appendChild(s);
  }
  defs.appendChild(el);
  return id;
}

/** A figure's bounds: x, y, right, bottom (a path's points' box). @param {any} item */
function extent(item) {
  if (item.kind !== 'path') return [item.x ?? 0, item.y ?? 0, item.right ?? 0, item.bottom ?? 0];
  const p = item.points ?? [];
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    l = Math.min(l, p[i]);
    r = Math.max(r, p[i]);
    t = Math.min(t, p[i + 1]);
    b = Math.max(b, p[i + 1]);
  }
  return l === Infinity ? [0, 0, 0, 0] : [l, t, r, b];
}

/** The default theme: the tokens a shape without a color or radius falls back on outside a root. */
const SHAPE_THEME = new Theme();
/** A shape's paint without a color of its own: the root's ink, as the canvases draw it; the default one outside a root. */
const INK = `var(--ren-ink, ${color(SHAPE_THEME.ink)})`;
/** A round's corner without a radius of its own: the root's radius. */
const ROUNDING = `var(--ren-radius, ${SHAPE_THEME.radius}px)`;

/**
 * Draws ren-core shapes (line, rect, round, oval, path) as SVG children. A
 * shape without a color takes the theme's ink, and a round without a radius
 * the theme's radius, as the canvases do: their attributes hold the default
 * theme's, and a style the root's custom properties, so a new theme reaches
 * them with no redraw.
 * @param {any} svg @param {any[]} list
 */
function shapes(svg, list) {
  const doc = svg.ownerDocument;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  /** The gradients of this list's fills, made on first use. @type {any} */
  let defs = null;
  for (const item of list) {
    const inked = item.color == null;
    const paint = inked ? color(SHAPE_THEME.ink) : color(item.color);
    const stroke = item.stroke ?? 0;
    /** The declarations that follow the root's theme. @type {string[]} */
    const themed = [];
    /** @type {any} */
    let el;
    if (item.kind === 'line') {
      el = doc.createElementNS(SVG, 'line');
      el.setAttribute('x1', item.x);
      el.setAttribute('y1', item.y);
      el.setAttribute('x2', item.right);
      el.setAttribute('y2', item.bottom);
      el.setAttribute('stroke', paint);
      el.setAttribute('stroke-width', item.stroke ?? 1);
      if (inked) themed.push(`stroke: ${INK}`);
    } else if (item.kind === 'oval') {
      el = doc.createElementNS(SVG, 'ellipse');
      el.setAttribute('cx', (item.x + item.right) / 2);
      el.setAttribute('cy', (item.y + item.bottom) / 2);
      el.setAttribute('rx', (item.right - item.x) / 2);
      el.setAttribute('ry', (item.bottom - item.y) / 2);
    } else if (item.kind === 'rect' || item.kind === 'round') {
      el = doc.createElementNS(SVG, 'rect');
      el.setAttribute('x', item.x);
      el.setAttribute('y', item.y);
      el.setAttribute('width', item.right - item.x);
      el.setAttribute('height', item.bottom - item.y);
      if (item.kind === 'round') {
        el.setAttribute('rx', item.radius ?? SHAPE_THEME.radius);
        if (item.radius == null) themed.push(`rx: ${ROUNDING}`);
      }
    } else if (item.kind === 'path') {
      el = doc.createElementNS(SVG, 'path');
      const p = item.points;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += ` L${p[i]} ${p[i + 1]}`;
      if (item.closed) d += ' Z';
      el.setAttribute('d', d);
    } else throw new Error(`REN: unsupported shape ${item.kind}`);
    // A dashed stroke, as SVG's stroke-dasharray (the canvases' too).
    if (Array.isArray(item.dash) && item.dash.length > 0) el.setAttribute('stroke-dasharray', item.dash.join(' '));
    if (item.kind !== 'line') {
      if (stroke > 0 || (item.kind === 'path' && !item.closed)) {
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', paint);
        el.setAttribute('stroke-width', stroke || 1);
        if (inked) themed.push(`stroke: ${INK}`);
      } else if (item.fill != null && typeof item.fill === 'object') {
        // A gradient over the figure's bounds, in place of its color.
        if (defs === null) svg.appendChild((defs = doc.createElementNS(SVG, 'defs')));
        const [x, y, right, bottom] = extent(item);
        el.setAttribute('fill', `url(#${shade(doc, defs, item.fill, x, y, right, bottom)})`);
      } else {
        el.setAttribute('fill', item.fill != null ? color(item.fill) : paint);
        if (item.fill == null && inked) themed.push(`fill: ${INK}`);
      }
    }
    // Each declaration ended by a semicolon, as a browser's cssText (and ren-html) writes them.
    if (themed.length > 0) el.setAttribute('style', `${themed.join('; ')};`);
    svg.appendChild(el);
  }
}

/** The DOM event a portable ren-core event listens to. @param {string} role @param {string} name */
function eventOf(role, name) {
  if (name === 'press') return 'click';
  if (name === 'change' && role === 'Edit') return 'input';
  if (name === 'key') return 'keydown';
  if (name === 'submit' && role === 'Edit') return 'keydown';
  return name;
}

/**
 * The ren-core event names `prevent` names: a string of names, a list, or true
 * for press and submit.
 * @param {any} value
 * @returns {string[]}
 */
function preventions(value) {
  if (value == null || value === false) return [];
  if (value === true) return ['press', 'submit'];
  if (Array.isArray(value)) return value.map(String);
  return String(value).split(/\s+/).filter(name => name.length > 0);
}

/**
 * DOM renderer options.
 * @typedef {object} Options
 * @property {import('ren-core/host').Tokens=} theme Theme overrides. An application root sets every token on its host element as a `--ren-<token>` custom property (colors as CSS colors, metrics in px), never on the document.
 * @property {boolean | string=} styles The renderer's stylesheet for the primitives, scoped to its root (true); false leaves styling to the application; a string adds CSS scoped to the root (inside `@scope` in the light DOM, the shadow root's own sheet otherwise).
 * @property {any=} document The document (`$shadow`: the host element's, at open).
 * @property {ArrayBuffer | Uint8Array | string | URL=} font The typeface the root's text is set in: the bytes or the URL of a font file (the one ren-skia and ren-three are given, so the DOM sets text as they do). Added to the document's fonts as `ren-<id>`; the root's text then has no kerning or ligatures, as the canvases draw it.
 * @property {ArrayBuffer | Uint8Array | string | URL=} mono The monospace typeface text whose `fontFamily` names monospace is set in (ren-skia's and ren-three's `mono`): `ren-<id>-mono`, through `--ren-mono`.
 * @property {Arranger=} layout Lay the primitives out with a layout engine instead of the browser: ren-canv's `Flow` (Taffy by default, in this thread or a layout worker). The engine places each primitive's element (absolutely, at its box) after every flush; the browser still paints them.
 * @property {import('ren-core/host').Behavior=} behavior As an application ('app', the default: loose text not selectable and with no I-beam, Ctrl or Cmd+A only in a field or `select: 'text'`, no browser menu but in a field, no touch callout) or a page ('page'), or `like` one with switches of its own (ren-core's `behaviorOf`).
 */

/**
 * What lays the primitives out when the browser does not (ren-canv's Flow):
 * an item per primitive, kept in step with the elements, and the boxes
 * that changed after each layout.
 * @typedef {object} Arranger
 * @property {(tag: string) => any} node The item of a primitive.
 * @property {(text: string) => any} text The item of a text node inside a primitive.
 * @property {(item: any, text: string) => void} content
 * @property {(item: any, name: string, value: any) => void} set
 * @property {(parent: any, child: any, before: any) => void} insert
 * @property {(parent: any, child: any) => void} remove
 * @property {(item: any, width: number) => void} island Lays the top of a view out on its own at a width.
 * @property {(item: any) => void} leave
 * @property {(item: any) => [number, number]} offset Where an item's box starts in its containing block.
 * @property {(done: (moved: any[]) => void) => void} arrange
 * @property {(tokens: import('ren-core/host').Tokens) => void} [retheme] Takes a new theme's metrics (`setTheme`), laid out at the next `arrange`.
 */

/**
 * Shadow renderer options.
 * @typedef {Options & { mode?: 'open' | 'closed' }} ShadowOptions
 */

/**
 * The renderer's stylesheet: primitives themed by the host's custom
 * properties. Selectors stop at nested roots (`:not(… [data-ren-root] *)`),
 * so a root never styles another one inside it.
 * @param {string} id @param {boolean} shadow @param {string} extra @param {Switches} behavior
 */
function sheet(id, shadow, extra, behavior) {
  const host = shadow ? ':host' : `[data-ren-root="${id}"]`;
  const within = shadow ? '' : `${host} `;
  const outside = shadow ? ':not([data-ren-root] *)' : `:not(${host} [data-ren-root] *)`;
  /** @param {string} selector @param {string} body */
  const rule = (selector, body) => `${within}${selector}${outside} { ${body} }\n`;
  let text = `${host} { color: var(--ren-ink); background: var(--ren-canvas); font-size: var(--ren-text); line-height: var(--ren-leading); }\n`;
  text += rule('[data-ren="Action"]', 'font: inherit; background: var(--ren-accent); color: var(--ren-paper); border: 0; border-radius: var(--ren-radius); min-height: var(--ren-field); padding: 0 var(--ren-inset);');
  text += rule('[data-ren="Edit"]', 'font: inherit; background: var(--ren-paper); color: var(--ren-ink); border: 1px solid var(--ren-border); border-radius: var(--ren-radius); min-height: var(--ren-field); min-width: var(--ren-entry); padding: 0 var(--ren-inset); resize: none;');
  text += `${within}[data-ren="Edit"]${outside}::placeholder { color: var(--ren-placeholder, var(--ren-muted)); }\n`;
  text += rule('[data-ren="Edit"]:disabled', 'background: var(--ren-soft); color: var(--ren-muted);');
  // The text fields the application writes, as an Edit (inline on it): selectable, with the I-beam, where loose text is not.
  const entry = [behavior.select ? '' : 'user-select: text; -webkit-user-select: text;', behavior.textCursor ? '' : 'cursor: text;'].filter(d => d !== '').join(' ');
  if (entry !== '') text += rule(`:is(textarea, input:is(:not([type]), ${TYPED_INPUTS}), [contenteditable]:not([contenteditable="false" i]))`, entry);
  // An Edit's mirror (its runs) as the theme sets the field, until it copies the field's computed style.
  text += rule('[data-ren-mirror]', 'font: inherit; color: var(--ren-ink); border-width: 1px; border-radius: var(--ren-radius); padding: 0 var(--ren-inset);');
  text += `${within}[data-ren-runs]${outside}::selection { color: transparent; -webkit-text-fill-color: transparent; }\n`;
  text += rule('[data-ren="Label"]', 'color: inherit;');
  text += rule('[data-ren="Scroll"]', 'height: var(--ren-region);');
  // A Scroll's bar as the canvases draw it: the theme's bar wide, a soft track, a muted round thumb inset 1 px; its
  // style's scrollbarWidth (its own: a nested Scroll starts from the theme's again) and scrollbarColor (inherited).
  text += rule('[data-ren="Scroll"]', '--ren-bar-size: initial; --ren-bars: initial;');
  const bar = (/** @type {string} */ part, /** @type {string} */ body) => `${within}[data-ren="Scroll"]${outside}::-webkit-scrollbar${part} { ${body} }\n`;
  text += bar('', 'width: var(--ren-bar-size, var(--ren-bar)); height: var(--ren-bar-size, var(--ren-bar));');
  text += bar('-track', 'background: var(--ren-track, var(--ren-soft));');
  text += bar('-thumb', 'background: var(--ren-thumb, var(--ren-muted)) padding-box; border: 1px solid transparent; border-radius: 4px; min-height: 24px; min-width: 24px;');
  text += bar('-corner', 'background: transparent;');
  // Where there is no ::-webkit-scrollbar (Firefox), the standard properties: the same thumb on the same track, as thin
  // as the theme's bar allows. Not in Blink and WebKit: either property set there turns the ::-webkit-scrollbar look off
  // (Chrome 121+), and theirs is the exact one.
  text += `@supports not selector(::-webkit-scrollbar) {\n${rule('[data-ren="Scroll"]', 'scrollbar-width: var(--ren-bars, var(--ren-scrollbar, thin)); scrollbar-color: var(--ren-thumb, var(--ren-muted)) var(--ren-track, var(--ren-soft));')}}\n`;
  text += rule(':is([data-ren="Image"], [data-ren="Shape"])', 'width: var(--ren-media); height: var(--ren-media);');
  // A focus ring handed on (ring false): none on the focused element; the browser's ring on those inside it
  // marked outer, or, with none, on the nearest element around it marked inner, along their corners.
  // (No :has inside :has, which CSS refuses: the item marked outer is excluded as a descendant of the focus.)
  const handing = '[data-ren-ring="false"]:focus-visible';
  text += rule('[data-ren-ring="false"]:is(:focus, :focus-visible)', 'outline: none;');
  text += rule(`[data-ren-ring="inner"]:has(${handing}):not(:has(${handing} [data-ren-ring="outer"])):not(:has([data-ren-ring="inner"] ${handing}))`, 'outline: auto; outline-offset: 0;');
  text += rule(`${handing} [data-ren-ring="outer"]`, 'outline: auto; outline-offset: 0;');
  if (extra !== '') text += shadow ? `${extra}\n` : `@scope (${host}) to ([data-ren-root]) {\n${extra}\n}\n`;
  return text;
}

/**
 * A Host over DOM documents; `mode` null renders into the light DOM, a
 * shadow mode into a shadow root of the application root's host element.
 * @param {any} document @param {Options} options @param {'open' | 'closed' | null} mode
 * @returns {Host}
 */
function make(document, options, mode) {
  let doc = document;
  const kind = mode === null ? 'dom' : 'shadow';
  /** As an application or a page (the `behavior` option): each switch on its own. */
  const behavior = behaviorOf(options.behavior);
  /** The switches off that write on the host element, whose cascade a nested root's host element stops. */
  const switched = SWITCHED.filter(([key]) => !behavior[key]);
  let theme = new Theme(options.theme);
  /** Writes the theme's tokens on the root's host element, as `--ren-<token>` custom properties. @param {any} host */
  const tokens = host => {
    const values = /** @type {Record<string, number>} */ (/** @type {unknown} */ (theme));
    for (const key in values) host.style.setProperty(`--ren-${key}`, COLORS.has(key) ? color(values[key]) : UNITLESS.has(key) ? String(values[key]) : `${values[key]}px`);
    // The standard scrollbar's width nearest the theme's bar (Firefox's thin is about 8 px).
    host.style.setProperty('--ren-scrollbar', scrollbar(theme.bar));
  };
  /** The faces the `font` and `mono` options added to the document's fonts. @type {any[]} */
  let faces = [];
  /**
   * Sets the root's text as the canvases set it when given their fonts: the
   * `font` face on the host element (so everything inside inherits it), the
   * `mono` face for families naming monospace (`--ren-mono`), and advances
   * alone, without kerning or ligatures, as ren-canv measures and draws.
   * @param {any} host @param {string} id
   */
  const typeset = (host, id) => {
    if (options.font == null && options.mono == null) return;
    const FontFace = doc.defaultView?.FontFace;
    /** @param {string} family @param {any} source */
    const add = (family, source) => {
      if (typeof FontFace === 'function' && doc.fonts != null) {
        const face = new FontFace(family, typeof source === 'string' || source instanceof URL ? `url(${JSON.stringify(String(source))})` : source);
        doc.fonts.add(face);
        face.load().catch(() => {});
        faces.push(face);
      }
      return JSON.stringify(family);
    };
    if (options.font != null) host.style.setProperty('font-family', `${add(`ren-${id}`, options.font)}, sans-serif`);
    if (options.mono != null) host.style.setProperty('--ren-mono', `${add(`ren-${id}-mono`, options.mono)}, monospace`);
    host.style.setProperty('font-kerning', 'none');
    host.style.setProperty('font-variant-ligatures', 'none');
  };
  /** The layout engine the primitives are placed by, when not the browser. */
  const flow = options.layout ?? null;
  /** Each primitive's (and text node's in one) item in the flow, and back. @type {WeakMap<any, any>} */
  const items = new WeakMap();
  /** @type {WeakMap<any, any>} */
  const elements = new WeakMap();
  /** The views' tops, by the element they are in (its width is theirs). @type {Map<any, Set<any>>} */
  const tops = new Map();
  /** The element each observed box stands for: itself, or the shadow root of a host (closed ones have no shadowRoot to read). @type {Map<any, any>} */
  const boxes = new Map();
  /** @type {any} */
  let watcher = null;
  /** The root's host element, container, and the stylesheet made for it. @type {any} */
  let element = null;
  /** @type {any} */
  let container = null;
  /** @type {any} */
  let style = null;
  /** @type {any} */
  let adopted = null;
  let opened = false;
  let closed = false;

  /** @type {WeakMap<any, string>} */
  const roles = new WeakMap();
  /** The listeners a `prevent` property added, by node. @type {WeakMap<any, (() => void)[]>} */
  const blocks = new WeakMap();
  /**
   * `prevent`: default actions to cancel synchronously, before any handler
   * (and before the event leaves for a worker). An Edit's submit cancels only Enter.
   * @param {any} node @param {any} value
   */
  const prevent = (node, value) => {
    const old = blocks.get(node);
    if (old !== undefined) for (const remove of old) remove();
    const role = roles.get(node) ?? '';
    blocks.set(
      node,
      preventions(value).map(name => {
        const event = eventOf(role, name);
        /** @param {any} e */
        const listener = e => {
          if (role === 'Edit' && name === 'submit' && e.key !== 'Enter') return;
          e.preventDefault();
        };
        node.addEventListener(event, listener, activeFor(event));
        return () => node.removeEventListener(event, listener);
      }),
    );
  };
  // Delegation: the handler of each delegated event type sits on its node
  // under this host's own key, so a nested root (another host) never runs
  // it, and one listener per type at each delegation root dispatches along
  // the composed path, the target first, up to that root.
  // The template this host cloned last (rows clone one plan in a row).
  /** @type {any} */
  let lastPlan = null;
  /** @type {any} */
  let lastDoc = null;
  /** @type {any} */
  let lastTemplate = undefined;
  /** Whether the last template's root takes its namespace from its parent, and that parent's (spaceOf). */
  let lastTakes = false;
  let lastSpace = 0;
  // The last delegated event name and its keys.
  let lastName = '';
  /** @type {symbol | null} */
  let lastKey = null;
  /** @type {symbol | null} */
  let lastRun = null;
  /** Handler keys by event type. @type {Map<string, symbol>} */
  const keys = new Map();
  /** Runner keys by event type: a delegated ren-core handler's runner, beside it. @type {Map<string, symbol>} */
  const runs = new Map();
  /** Delegation roots and how many attached each. @type {Map<any, number>} */
  const roots = new Map();
  /** The select-all guard of each delegation root, to remove with it. @type {Map<any, () => void>} */
  const guards = new Map();
  /** The key an event carries: the last root this host dispatched it to. */
  const walked = Symbol('ren.walked');
  /** @param {any} e */
  const dispatch = e => {
    const key = keys.get(e.type);
    if (key === undefined) return;
    const top = e.currentTarget;
    const path = e.composedPath();
    let i = 0;
    // A deeper root of this host (a portal's target inside the container)
    // walked the path below itself already; continue from it (a walk stops
    // before its own root, whose handler belongs to the walk above).
    const from = e[walked];
    if (from !== undefined) {
      const at = path.indexOf(from);
      if (at >= 0) i = at;
    }
    e[walked] = top;
    /** @type {any} */
    let node = null;
    Object.defineProperty(e, 'currentTarget', { configurable: true, get: () => node ?? top });
    try {
      for (; i < path.length; i++) {
        const n = path[i];
        if (n === top) break;
        const handler = n[key];
        if (handler !== undefined && handler !== null) {
          node = n;
          const run = n[/** @type {symbol} */ (runs.get(e.type))];
          if (run !== undefined && run !== null) run.run(handler, e);
          else handler(e);
          if (e.cancelBubble) break;
        }
      }
    } finally {
      delete e.currentTarget;
    }
  };
  /**
   * A native drag that starts in a primitive (a selection's text, an
   * Image) is cancelled, as the canvases start none: it would take the
   * pointer from the gesture pressing there (a Carousel's swipe, a
   * slider's thumb). The HTML the application writes keeps its own drags,
   * and so does a primitive it makes `draggable` or that hears `onDragStart`
   * (or one inside them).
   * @param {any} e
   */
  const undrag = e => {
    const top = e.currentTarget;
    let n = e.target;
    if (n != null && n.nodeType !== 1) n = n.parentNode;
    if (n == null || !roles.has(n)) return;
    for (; n != null && n !== top; n = n.parentNode) if (n[DRAGS] === true || (n.nodeType === 1 && n.getAttribute('draggable') === 'true')) return;
    e.preventDefault();
  };
  /**
   * The browser's context menu, with the behavior's `menu` or `editMenu`
   * off: in a field `editMenu` decides (paste, spelling), elsewhere `menu`.
   * A nested root's nodes are its own to decide; the handlers still hear
   * the event.
   * @param {any} e
   */
  const unmenu = e => {
    let n = e.target;
    if (n != null && n.nodeType !== 1) n = n.parentNode;
    if (whose(n, e.currentTarget) < 0 || (field(n) ? behavior.editMenu : behavior.menu)) return;
    e.preventDefault();
  };
  /**
   * Ctrl or Cmd+A, with the behavior's `selectAll` off, for a key of the
   * root (as `$keys` hears it: focused in it, or nothing focused while the
   * selection is in it or in no root): a field selects its own text (the
   * browser's); else the text opted in (`select: 'text'`) around the
   * selection or the focus is selected, and nothing else is.
   * @param {any} node a delegation root
   */
  const unselect = node =>
    rooted(node, (e, path) => {
      if ((e.key !== 'a' && e.key !== 'A') || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented || e.editable) return;
      const d = node.ownerDocument ?? doc;
      const top = typeof node.getRootNode === 'function' ? node.getRootNode() : d;
      // A shadow root's own selection where the browser has one (the document's shows its host).
      const selection = (typeof top.getSelection === 'function' ? top : d).getSelection?.() ?? null;
      const anchor = selection?.anchorNode ?? null;
      const t = path[0] ?? e.target;
      const loose = t === d.body || t === d.documentElement || t === d;
      if (loose ? anchor !== null && whose(anchor, node) < 0 : whose(t, node) < 0) return;
      // The selection may lie in a root nested in this one while the focus is this one's (a drag over a nested root's text
      // leaves the focus where it was): its opted-in text is selected all the same.
      const opted = (anchor !== null && around(node, anchor) ? optedIn(anchor, node) : null) ?? (loose ? null : optedIn(t, node));
      if (opted !== null && selection !== null) {
        const range = d.createRange();
        range.selectNodeContents(opted);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      e.preventDefault();
    });
  /** @param {string} event */
  const keyOf = event => {
    let key = keys.get(event);
    if (key === undefined) {
      key = Symbol(`ren.${event}`);
      keys.set(event, key);
      runs.set(event, Symbol(`ren.${event}.run`));
      for (const target of roots.keys()) target.addEventListener(event, dispatch, activeFor(event));
    }
    return key;
  };
  /** The resize handlers of each node a ResizeObserver watches, and the observer (made on first use). @type {Map<any, Set<(event: any) => void>>} */
  const resizes = new Map();
  /** @type {any} */
  let resizer = null;
  /**
   * `onResize`: a node's border box as a ResizeObserver reports it (where the
   * window has one), once observed and after each change of size.
   * @param {any} node @param {(event: any) => void} handler
   */
  const sized = (node, handler) => {
    const Observer = node.ownerDocument?.defaultView?.ResizeObserver;
    if (typeof Observer !== 'function') return () => {};
    if (resizer === null)
      resizer = new Observer((/** @type {any[]} */ entries) => {
        for (const entry of entries) {
          const set = resizes.get(entry.target);
          if (set === undefined) continue;
          const border = entry.borderBoxSize?.[0] ?? entry.borderBoxSize;
          const rect = border == null ? entry.target.getBoundingClientRect() : null;
          const width = border != null ? border.inlineSize : rect.width;
          const height = border != null ? border.blockSize : rect.height;
          for (const fn of [...set]) fn({ type: 'resize', target: entry.target, currentTarget: entry.target, width, height });
        }
      });
    let set = resizes.get(node);
    if (set === undefined) {
      resizes.set(node, (set = new Set()));
      resizer.observe(node);
    }
    set.add(handler);
    return () => {
      const own = resizes.get(node);
      if (own === undefined || !own.delete(handler) || own.size > 0) return;
      resizes.delete(node);
      resizer?.unobserve(node);
    };
  };
  /**
   * Root-wide keys (ren-core's `$keys`, `listen(container, 'keys')`): the
   * document's keydown, heard after the focused element's handlers (the
   * root's delegation is below the document), for a key whose target is
   * inside the view's container (its shadow root, its portals by default)
   * or the document's body (nothing has focus). The event's `editable` says
   * whether its target (inside a shadow root too) is a text field: an input,
   * textarea, select or contenteditable element. In a shadow root the
   * document cannot see into (a closed one hides its nodes from the path
   * and retargets to its host), the root's own keydown notes the path first;
   * the handler is given that path.
   * @param {any} node the container @param {(event: any, path: any[]) => void} handler
   */
  const rooted = (node, handler) => {
    const d = node.ownerDocument ?? doc;
    const top = typeof node.getRootNode === 'function' ? node.getRootNode() : d;
    const shadow = top !== d && top.host != null ? top : null;
    /** The path each key had inside the shadow root. @type {WeakMap<any, any[]>} */
    const inner = new WeakMap();
    /** @param {any} e */
    const note = e => void inner.set(e, e.composedPath());
    /** @param {any} e */
    const listener = e => {
      const t = e.target;
      const path = inner.get(e) ?? e.composedPath();
      if (t === d.body || t === d.documentElement || t === d || path.includes(node)) {
        e.editable = field(path[0] ?? t);
        handler(e, path);
      }
    };
    shadow?.addEventListener('keydown', note);
    d.addEventListener('keydown', listener);
    return () => {
      shadow?.removeEventListener('keydown', note);
      d.removeEventListener('keydown', listener);
    };
  };
  /**
   * Root-wide scrolls (ren-core's `$scrolls`, `listen(container,
   * 'scrolls')`): the document's scroll events in the capture phase (they do
   * not bubble), and a shadow root's (they are not composed), for a scroll
   * that can move the container's nodes: the page, an element around the
   * container, or one inside it.
   * @param {any} node the container @param {(event: any) => void} handler
   */
  const scrolled = (node, handler) => {
    const d = node.ownerDocument ?? doc;
    /** @param {any} e */
    const listener = e => {
      const t = e.target;
      if (t === d || t === d.documentElement || t === d.body || around(t, node) || e.composedPath().includes(node)) handler(e);
    };
    const top = typeof node.getRootNode === 'function' ? node.getRootNode() : d;
    const shadow = top !== d && top.host != null ? top : null;
    d.addEventListener('scroll', listener, true);
    shadow?.addEventListener('scroll', listener, true);
    return () => {
      d.removeEventListener('scroll', listener, true);
      shadow?.removeEventListener('scroll', listener, true);
    };
  };
  /**
   * A node's moves (ren-core's `$moves`, `listen(node, 'move')`): an
   * IntersectionObserver whose root is the document and whose root margin
   * leaves exactly the node's box, so any move changes its ratio and is
   * heard in the next rendering step; then the box is measured, told when
   * its place changed, and observed again where it now is. A box partly
   * clipped (by a Scroll, the viewport's edge) is observed at its ratio,
   * heard when that grows or shrinks; one clipped whole waits until it shows
   * again. It is observed at once when it is in the document, and again by
   * a ResizeObserver when its size changes (or once it is laid out). Where the window has no IntersectionObserver
   * nothing is heard.
   * @param {any} node @param {(event: any) => void} handler
   */
  const moving = (node, handler) => {
    const d = node.ownerDocument ?? doc;
    const Observer = d.defaultView?.IntersectionObserver;
    if (typeof Observer !== 'function') return () => {};
    /** Where it was last told (NaN: not yet measured). */
    let x = NaN;
    let y = NaN;
    /** The size of the box observed. */
    let w = -1;
    let h = -1;
    let open = true;
    /** @type {any} */
    let io = null;
    /** Measures the box: true (after telling) when it moved. @param {any} r */
    const place = r => {
      if (x !== x) {
        x = r.x;
        y = r.y;
        return false;
      }
      if (r.x === x && r.y === y) return false;
      x = r.x;
      y = r.y;
      handler({ type: 'move', x, y, target: node, currentTarget: node });
      return true;
    };
    /** Measures, tells a move, and observes the box where it is, at `ratio` of it showing (1: whole). @param {number} ratio */
    const observe = ratio => {
      io?.disconnect();
      io = null;
      if (!open || !node.isConnected) return;
      const r = node.getBoundingClientRect();
      place(r);
      w = r.width;
      h = r.height;
      if (!open || w <= 0 || h <= 0) return;
      const root = d.documentElement;
      const margin = `${-Math.floor(r.top)}px ${-Math.floor(root.clientWidth - r.right)}px ${-Math.floor(root.clientHeight - r.bottom)}px ${-Math.floor(r.left)}px`;
      // Clipped: heard when more or less of it shows; clipped whole: when any shows.
      const threshold = ratio >= 1 ? [1] : ratio <= 0 ? [1e-7] : [ratio, Math.min(1, ratio + 1e-4)];
      let first = true;
      /** @type {any} */
      let own = null;
      /** @param {any[]} entries */
      const heard = entries => {
        // A report queued before it was replaced.
        if (own === null || io !== own) return;
        const now = entries[entries.length - 1].intersectionRatio;
        if (!first) return observe(1);
        first = false;
        // The first report says how much of it shows: observed again at that ratio unless it is the one asked.
        if (ratio <= 0 ? now > 0 : now !== ratio) return observe(now);
        // Whole within its margin, yet placed apart (under a pixel, or smaller): measured again.
        if (now === 1) {
          const b = node.getBoundingClientRect();
          if (b.x !== r.x || b.y !== r.y || b.width !== r.width || b.height !== r.height) observe(1);
        }
      };
      try {
        own = new Observer(heard, { root: d, rootMargin: margin, threshold });
      } catch {
        // A browser without a document root: the viewport's.
        own = new Observer(heard, { rootMargin: margin, threshold });
      }
      io = own;
      own.observe(node);
    };
    // Observed at once in the document, else once laid out; again at each new size.
    const unsized = sized(node, (/** @type {any} */ e) => {
      if (io === null || e.width !== w || e.height !== h) observe(1);
    });
    if (node.isConnected) observe(1);
    return () => {
      open = false;
      io?.disconnect();
      io = null;
      unsized();
    };
  };
  /**
   * `onDrop`: files dropped on a node, as `{ files, x, y }`; its dragover is
   * accepted (cancelled) while it listens, and the drop's default (the
   * browser opening the file) cancelled.
   * @param {any} node @param {(event: any) => void} handler
   */
  const dropped = (node, handler) => {
    /** @param {any} e */
    const over = e => e.preventDefault();
    /** @param {any} e */
    const drop = e => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      handler({ type: 'drop', files: files == null ? [] : [...files], x: e.clientX ?? 0, y: e.clientY ?? 0, target: e.target, currentTarget: node, stopPropagation: () => e.stopPropagation(), event: e });
    };
    node.addEventListener('dragover', over);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('drop', drop);
    };
  };
  /**
   * `onDragEnter`, `onDragOver`, `onDragLeave` on a primitive: the DOM's
   * own, as ren-core's portable drag (`{ x, y, files, types }`: the file
   * items' count and MIME types, all a drag tells before the drop).
   * @param {any} node @param {string} name @param {(event: any) => void} handler
   */
  const dragging = (node, name, handler) => {
    /** @param {any} e */
    const listener = e => {
      const items = e.dataTransfer?.items;
      /** @type {string[]} */
      const types = [];
      if (items != null) for (const item of items) if (item.kind === 'file') types.push(item.type ?? '');
      handler({ type: name, x: e.clientX ?? 0, y: e.clientY ?? 0, files: types.length, types, target: e.target, currentTarget: node, stopPropagation: () => e.stopPropagation(), event: e });
    };
    node.addEventListener(name, listener);
    return () => node.removeEventListener(name, listener);
  };
  /** The classes of state styles (hover, press, focus) this host made, by their CSS. @type {Map<string, string>} */
  const states = new Map();
  /** The stylesheet state classes go in, made on first use. @type {any} */
  let stateSheet = null;
  /** Each state class's rules and the text node that holds them in the state sheet. @type {Map<string, { rules: string, text: any }>} */
  const made = new Map();
  /** How many live nodes carry each state class: a node restyled or let go by the collector gives its use back. @type {Map<string, number>} */
  const users = new Map();
  /** The state classes made so far, which numbers the next (never reused: a node let go late gives back only its own). */
  let classes = 0;
  /** How many state classes the sheet holds before those without users go. */
  let sweepAt = COMPOSED;
  /** @param {string} name @param {number} by */
  const use = (name, by) => {
    const n = users.get(name);
    if (n !== undefined) users.set(name, n + by);
  };
  const collected = new FinalizationRegistry((/** @type {{ name: string }} */ held) => use(held.name, -1));
  /**
   * Removes the rules and text node of each state class no live node
   * carries (but `keep`, just made), and what the composed cache knows of
   * them; the next sweep waits until the sheet holds twice what is left.
   * @param {string} keep
   */
  const sweep = keep => {
    for (const [name, entry] of made)
      if (name !== keep && users.get(name) === 0) {
        entry.text.parentNode?.removeChild(entry.text);
        states.delete(entry.rules);
        made.delete(name);
        users.delete(name);
      }
    for (const [key, name] of composed) if (!made.has(name)) composed.delete(key);
    sweepAt = Math.max(COMPOSED, made.size * 2);
  };
  /**
   * The state class of each distinct style (by role and content): styles
   * alike share one composition. Bounded, the least recently used going
   * first: a base value that changes on every frame (a drag's `left`) makes
   * a new style each time, all of one class.
   * @type {Map<string, string>}
   */
  const composed = new Map();
  /** A scratch declaration of this document, which serializes a rule's declarations as its CSSOM parses them. @type {any} */
  let scratch = null;
  /**
   * A rule's declarations, `!important`, each pair checked on its own, so no
   * pair can reach past itself into the rest of the rule or the sheet:
   * - its name must be a property's, and its value must hold none of
   *   `UNSAFE` (a brace, `;`, `<`, `>` or any newline CSS reads: line feed,
   *   carriage return, form feed) and be `sealed` as CSS tokenizes it
   *   (checked by hand, as a document without a CSSOM, ren-html's, keeps
   *   what it is given);
   * - with a CSSOM, the pair is parsed with a sentinel after it
   *   (`--ren-end: 0`), and kept only when the sentinel reads back, as the
   *   CSSOM keeps its value (an invalid one is dropped, as inline).
   * @param {[string, string][]} pairs
   */
  const declarations = pairs => {
    scratch ??= doc.createElement('div').style;
    /** @type {string[]} */
    const out = [];
    for (const [k, v] of pairs) {
      if (!PROPERTY.test(k) || UNSAFE.test(v) || !sealed(v)) continue;
      scratch.cssText = `${k}: ${v} !important; --ren-end: 0`;
      const end = String(scratch.getPropertyValue('--ren-end')).trim();
      // A document without a CSSOM keeps the priority in the value.
      const kept = String(scratch.getPropertyValue(k)).trim().replace(/\s*!important$/i, '');
      if (end === '0' && kept !== '') out.push(`${k}: ${kept} !important`);
    }
    return out.join('; ');
  };
  /**
   * The state class of a portable style: its rules written once into the
   * state sheet (a class per distinct rule set), '' without states.
   * @param {any} s @param {string} role
   */
  const stateClass = (s, role) => {
    if (s.hover == null && s.press == null && s.focus == null) return '';
    const key = `${role}\u0000${JSON.stringify(s)}`;
    let name = composed.get(key);
    if (name === undefined) {
      name = stateName(stateRules(s, role));
      if (composed.size >= COMPOSED) composed.delete(/** @type {string} */ (composed.keys().next().value));
    } else composed.delete(key);
    composed.set(key, name);
    return name;
  };
  /**
   * The states as the canvases compose them, in their order (ren-canv's layout: base, then
   * hover, then press, then focus, each overlaying the one before). Every combination the
   * style has a state for gets a rule, the compound ones (`:hover:active`, …) winning by
   * specificity, so a hover and a press together show what the canvases show.
   * @param {any} s @param {string} role
   */
  const stateRules = (s, role) => {
    const plain = { ...s };
    delete plain.hover;
    delete plain.press;
    delete plain.focus;
    /** @type {[string, any][]} */
    const present = /** @type {[string, any][]} */ ([[':hover', s.hover], [':active', s.press], [':focus', s.focus]]).filter(([, state]) => state != null);
    const cssOf = (/** @type {any} */ v) => css(flow === null ? v : painted(v, role), role);
    const base = cssOf(plain);
    const baseRuns = familyRuns(base);
    /** The keys each combination's rule declares, by its selector. @type {Map<string, Set<string>>} */
    const declared = new Map();
    let rules = '';
    for (let size = 1; size <= present.length; size++)
      for (let mask = 1; mask < 1 << present.length; mask++) {
        const members = present.filter((_, i) => (mask & (1 << i)) !== 0);
        if (members.length !== size) continue;
        // Each state over what came before: the others' keys first, then its own in their order.
        let merged = plain;
        for (const [, state] of members) {
          /** @type {Record<string, any>} */
          const next = {};
          for (const k in merged) if (!(k in state)) next[k] = merged[k];
          for (const k in state) next[k] = state[k];
          merged = next;
        }
        const out = cssOf(merged);
        const outRuns = familyRuns(out);
        const pseudo = members.map(([p]) => p).join('');
        /** @type {Set<string>} */
        const keys = new Set();
        // What differs from the base; a family whose declarations or their order differ goes whole
        // (border-width then border-left-width is not border-left-width then border-width).
        /** @type {Set<string>} */
        const whole = new Set();
        for (const k in out) {
          const f = familyOf(k);
          if (base[k] !== out[k] || outRuns.get(f) !== baseRuns.get(f)) {
            keys.add(k);
            whole.add(f);
          }
        }
        for (const j in out) if (whole.has(familyOf(j))) keys.add(j);
        // What a rule of fewer of these states declares, this one says again, so it never shows through.
        for (const [selector, list] of declared) if (selector.split(':').filter(Boolean).every(p => pseudo.includes(`:${p}`))) for (const k of list) keys.add(k);
        declared.set(pseudo, keys);
        /** @type {[string, string][]} */
        const pairs = [...Object.keys(out).filter(k => keys.has(k)), ...[...keys].filter(k => !(k in out) && k in base)].map(k => [k, out[k] ?? base[k]]);
        const body = declarations(pairs);
        if (body !== '') rules += `.@${pseudo} { ${body} }\n`;
      }
    return rules;
  };
  /** The class of a set of rules, their text added to the state sheet once. @param {string} rules */
  const stateName = rules => {
    if (rules === '') return '';
    let name = states.get(rules);
    if (name === undefined) {
      name = `ren-${kind}-${own()}-${++classes}`;
      states.set(rules, name);
      if (stateSheet === null) {
        stateSheet = doc.createElement('style');
        stateSheet.setAttribute('data-ren-states', '');
        const into = container ?? doc.head ?? doc.body;
        into.insertBefore(stateSheet, into.firstChild);
      }
      // A text node of its own: the sheet's text is not rebuilt as a string for every rule set.
      const text = doc.createTextNode(rules.split('.@').join(`.${name}`));
      stateSheet.appendChild(text);
      made.set(name, { rules, text });
      users.set(name, 0);
      if (made.size > sweepAt) sweep(name);
    }
    return name;
  };
  /**
   * Gives the focus up when the nodes from `first` to `last` (children of
   * `parent`), about to be removed or hidden, hold it: the browser sends no
   * focusout for an element removed or hidden while focused, so the element
   * is blurred first, and its `blur` and bubbling `focusout`
   * (`relatedTarget` null) reach the ancestors it has, as on ren-canv. Cheap
   * while nothing inside a view has focus.
   * @param {any} parent @param {any} first @param {any} last
   */
  const release = (parent, first, last) => {
    const outer = doc.activeElement;
    if (outer === null || outer === doc.body || outer === doc.documentElement) return;
    // Inside a shadow root the document's active element is its host.
    const active = parent.getRootNode().activeElement;
    if (active == null || !parent.contains(active)) return;
    for (let n = first; n !== null; n = n.nextSibling) {
      if (n.contains(active)) {
        active.blur();
        return;
      }
      if (n === last) return;
    }
  };
  /**
   * Applies a primitive's portable style: its CSS inline, its states as a
   * class; the shorthand props it no longer overrides come back.
   * @param {any} node @param {string} role @param {any} value
   */
  const look = (node, role, value) => {
    const s = value != null && typeof value === 'object' ? value : {};
    const before = node[LOOK];
    node[LOOK] = s;
    // Its focus ring, for the sheet: handed on (false), or drawn for an inner or an outer focus.
    const ring = s.ring === false ? 'false' : s.ring === 'inner' || s.ring === 'outer' ? s.ring : null;
    if (ring !== null) node.setAttribute('data-ren-ring', ring);
    else if (before !== undefined && before.ring !== undefined) node.removeAttribute('data-ren-ring');
    const out = css(flow === null ? s : painted(s, role), role);
    const style = node.style;
    /** @type {Record<string, string> | undefined} */
    const wrote = node[WROTE];
    if (wrote !== undefined)
      for (const key in wrote)
        if (!(key in out)) {
          // What the style stops setting goes back to the primitive's base (its position, a container's display).
          const base = defaultOf((flow === null ? BASES : POSITIONED_BASES)[role] ?? '', key);
          if (base === undefined) style.removeProperty(key);
          else style.setProperty(key, base);
        }
    if (node[EDGE] !== undefined) {
      // A multi-line Edit's rows' padding: again for another top border, or where the style stopped padding it (the style's own wins, below).
      const edge = edgeOf(out);
      if (edge !== node[EDGE] || (wrote !== undefined && ('padding-top' in wrote || 'padding-bottom' in wrote))) {
        node[EDGE] = edge;
        style.paddingBlock = rowsPad(edge);
      }
    }
    for (const key in out) style.setProperty(key, out[key]);
    // A height the style no longer sets goes back to an autosized Edit's own, not the base's.
    if (node[AUTOSIZE] !== undefined && wrote !== undefined && ('min-height' in wrote || 'max-height' in wrote || 'height' in wrote)) {
      const heights = heightsOf(node[AUTOSIZE], node.rows);
      for (const key in heights)
        if (key in wrote && !(key in out)) {
          if (heights[key] === '') style.removeProperty(key);
          else style.setProperty(key, heights[key]);
        }
    }
    if (node[HIDE] === true) style.display = 'none';
    else if (node[CLAMP] > 0 || node[ELLIPSIS] === true) trim(node, (flow === null ? BASES : POSITIONED_BASES)[role] ?? '');
    // An Edit's width replaces the theme's minimum.
    if (flow === null && role === 'Edit' && s.width != null && !('min-width' in out)) style.setProperty('min-width', '0px');
    node[WROTE] = out;
    const old = before === undefined ? '' : node.getAttribute('data-ren-state') ?? '';
    const next = stateClass(s, role);
    if (old !== next) {
      /** @type {{ name: string } | undefined} */
      let held = node[HELD];
      if (held === undefined) collected.register(node, (held = node[HELD] = { name: '' }));
      use(old, -1);
      use(next, 1);
      held.name = next;
      if (old !== '') node.classList.remove(old);
      if (next !== '') node.classList.add(next);
      if (next === '') node.removeAttribute('data-ren-state');
      else node.setAttribute('data-ren-state', next);
    }
    // Shorthands the style stopped overriding apply again.
    const short = node[SHORT];
    if (short !== undefined && before !== undefined)
      for (const name in short) {
        if ((name === 'layout' || s[SHORTHANDS[name]] == null) && !(flow !== null && placed(role, name))) primitive(node, role, name, short[name]);
      }
  };
  /** The width a view's top is laid out at: its container's content width. @param {any} parent */
  const widthOf = parent => {
    const box = parent.host ?? parent;
    const cs = box.ownerDocument?.defaultView?.getComputedStyle?.(box);
    const padding = cs === undefined ? 0 : (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(0, (box.clientWidth ?? 0) - padding);
  };
  /**
   * Follows a node into the flow: a primitive (or a text node in one) under
   * a primitive joins its parent's item; a primitive elsewhere is the top of
   * a view, laid out at its container's width (followed as it resizes).
   * @param {any} parent @param {any} child @param {any} before
   */
  const place = (parent, child, before) => {
    const f = /** @type {Arranger} */ (flow);
    const up = items.get(parent);
    let item = items.get(child);
    if (up !== undefined) {
      if (item === undefined) {
        if (child.nodeType !== 3) return;
        item = f.text(child.data);
        items.set(child, item);
      }
      let next = before;
      while (next != null && items.get(next) === undefined) next = next.nextSibling;
      f.insert(up, item, next == null ? null : items.get(next));
      if (child.style !== undefined && roles.has(child)) child.style.position = 'absolute';
      return;
    }
    if (item === undefined || !roles.has(child)) return;
    f.island(item, widthOf(parent));
    child.style.position = 'relative';
    let set = tops.get(parent);
    if (set === undefined) {
      tops.set(parent, (set = new Set()));
      const Observer = (parent.host ?? parent).ownerDocument?.defaultView?.ResizeObserver;
      if (watcher === null && typeof Observer === 'function')
        watcher = new Observer((/** @type {any[]} */ entries) => {
          for (const entry of entries) {
            // The parent observed through this box (a shadow root through its host, closed or open).
            const parent = boxes.get(entry.target);
            const within = parent === undefined ? undefined : tops.get(parent);
            if (within === undefined) continue;
            const width = widthOf(parent);
            for (const top of within) f.island(items.get(top), width);
          }
          /** @type {any} */ (H).present();
        });
      boxes.set(parent.host ?? parent, parent);
      watcher?.observe(parent.host ?? parent);
    }
    set.add(child);
  };
  /** A node leaves its parent: its item leaves the flow. @param {any} parent @param {any} child */
  const unplace = (parent, child) => {
    const f = /** @type {Arranger} */ (flow);
    const item = items.get(child);
    if (item === undefined) return;
    const up = items.get(parent);
    if (up !== undefined) {
      f.remove(up, item);
      return;
    }
    f.leave(item);
    const set = tops.get(parent);
    if (set !== undefined) {
      set.delete(child);
      if (set.size === 0) {
        tops.delete(parent);
        boxes.delete(parent.host ?? parent);
        watcher?.unobserve(parent.host ?? parent);
      }
    }
  };
  /**
   * Applies a property to a node (the Host's `set`, less an Edit's runs).
   * @param {any} node @param {string} name @param {any} value @param {any} previous
   */
  const put = (node, name, value, previous) => {
    if (name === 'prevent') {
      prevent(node, value);
      return;
    }
    // No primitive property is named class: those skip the role lookup.
    if (name === 'class' || name === 'className') {
      node.setAttribute('class', value == null ? '' : String(value));
      return;
    }
    const role = roles.get(node);
    if (flow !== null && role !== undefined) {
      flow.set(items.get(node), name, value);
      if (placed(role, name)) {
        (node[SHORT] ??= {})[name] = value;
        return;
      }
    }
    if (role !== undefined) {
      if (name === 'hidden') {
        if (value && node.parentNode !== null) release(node.parentNode, node, node);
        node[HIDE] = !!value;
        // Shown again, it takes back the display it had (its base's, its style's, a clamp's).
        node.style.display = value ? 'none' : displayOf(node, (flow === null ? BASES : POSITIONED_BASES)[role] ?? '');
        return;
      }
      if (role === 'Edit') {
        if (name === 'lines') return;
        if (name === 'autosize') {
          // A layout engine sizes it instead (its item has the prop), from the value typed too: an Edit the
          // view does not control tells its item its value as it changes, and the flow lays out again.
          if (flow === null) autosize(node, value);
          else if (node[TYPED] === undefined) {
            const item = items.get(node);
            node[TYPED] = () => {
              if (item === undefined || item.autosize === 0) return;
              flow.set(item, 'value', node.value);
              /** @type {() => void} */ (H.present)();
            };
            node.addEventListener('input', node[TYPED]);
          }
          return;
        }
      } else if (role === 'Label' && (name === 'lines' || name === 'ellipsis')) {
        if (name === 'lines') node[CLAMP] = typeof value === 'number' && value >= 1 ? Math.floor(value) : 0;
        else node[ELLIPSIS] = !!value;
        trim(node, (flow === null ? BASES : POSITIONED_BASES)[role] ?? '');
        return;
      }
    }
    if (role !== undefined && name === 'style') {
      look(node, role, value);
      return;
    }
    if (role !== undefined && name === 'aria-label') {
      // The application's name wins over the label's; without one, the label names it again.
      const own = value != null && value !== false;
      node[NAMED] = own;
      if (own) node.setAttribute(name, String(value));
      else if (node[LABEL] !== undefined) node.setAttribute(name, node[LABEL]);
      else node.removeAttribute(name);
      return;
    }
    if (role !== undefined && primitive(node, role, name, value)) return;
    if (name === 'role' && node[SELECTED] !== undefined) {
      if (value == null || value === false) node.removeAttribute('role');
      else node.setAttribute('role', String(value));
      pressed(node);
      return;
    }
    if (name === 'style') {
      if (value == null || typeof value === 'string') {
        node.style.cssText = value ?? '';
        return;
      }
      const style = node.style;
      // An object after a string: the string's declarations go first.
      if (typeof previous === 'string') style.cssText = '';
      const was = previous != null && typeof previous === 'object' ? previous : null;
      if (was !== null)
        for (const key in was) {
          if (key in value) continue;
          style.removeProperty(kebab(key));
        }
      for (const key in value) {
        const v = value[key];
        if (was === null || was[key] !== v) {
          if (v == null) style.removeProperty(kebab(key));
          else style.setProperty(kebab(key), cssValue(key, v));
        }
      }
      return;
    }
    // What would run script is never written: a javascript: URL, an iframe's srcdoc (markup), a javascript: value
    // an SVG animation gives the attribute it names. The attribute goes, as for null, so no earlier value stays.
    const risk = riskOf(name);
    if (risk === HANDLER) {
      // A handler is a function, held by the element's handler property (onclick, on an HTML, SVG or MathML
      // element); a string, any case, on any element, would be script: no attribute is written. A function
      // with no handler property to hold it writes nothing either (its text would be a string handler).
      const fn = typeof value === 'function';
      const now = name in node ? node[name] : undefined;
      const held = now === null || typeof now === 'function';
      if (held) node[name] = fn ? value : null;
      if (!fn || !held) node.removeAttribute(name);
      return;
    }
    if (risk !== SAFE && value != null && value !== false) {
      if (
        risk === SRCDOC ||
        (risk === LINK && scripted(value)) ||
        (risk === ANIMATION && node.namespaceURI === SVG && (node.localName === 'animate' || node.localName === 'set') && String(value).split(';').some(scripted))
      ) {
        node.removeAttribute(name);
        return;
      }
    }
    // A boolean download is a flag (download=""), as ren-html writes it; its string property would write 'true'.
    const flag = name === 'download' && typeof value === 'boolean';
    if (!flag && name in node && !(node.namespaceURI === SVG) && name !== 'list' && name !== 'form') {
      // A null or undefined value empties a control, as ren-html and ren-json read it (the property would
      // take the text "undefined"); a select is not assigned, so it keeps its choice. An input loses its
      // value attribute, and one whose value is its own (a text field, not a checkbox, radio, hidden or
      // button, whose value is the attribute) is emptied too: a checkbox submits "on" again, a submit
      // shows its default label, whichever of type and value came first.
      if (value == null && name === 'value') {
        if (node.localName === 'select') delete node[CHOSEN];
        else if (node.localName === 'input') {
          node.removeAttribute('value');
          if (!ATTRIBUTE_VALUED.has(node.type) && node.value !== '') node.value = '';
        } else if (node.localName === 'textarea' || node.localName === 'output') node.value = '';
        else node.removeAttribute('value');
        return;
      }
      // null or undefined removes a reflected attribute (a string or number property would write
      // "null" or coerce it, tabIndex to 0; a token list, sandbox or relList, forwards it to its value),
      // as ren-html writes nothing; `value` and flags stay properties.
      const now = node[name];
      if (value == null && name !== 'value' && (typeof now === 'string' || typeof now === 'number' || (now != null && typeof now === 'object' && typeof now.value === 'string'))) {
        if (CONTENT.has(name)) node[name] = '';
        else node.removeAttribute(REFLECTED[name] ?? (/^aria[A-Z]/.test(name) ? `aria-${name.slice(4).toLowerCase()}` : name));
        return;
      }
      node[name] = value;
      // A URL part edits the href: one that makes it javascript: (a protocol on a mailto: link) drops it.
      if (risk === URL_PART && scripted(node.getAttribute('href') ?? '')) node.removeAttribute('href');
      // A select's props come before its options, and before their values:
      // it keeps a value no option names yet, for the option that does.
      if (name === 'value' && node.localName === 'select') {
        if (value != null && (node.selectedIndex < 0 || node.value !== String(value))) {
          node[CHOSEN] = String(value);
          // Added once per select (the same listener is not added twice).
          node.addEventListener('input', unchoose);
          node.addEventListener('change', unchoose);
        } else delete node[CHOSEN];
      } else if (name === 'value' && node.localName === 'option' && node.parentNode !== null) choose(selectOf(node.parentNode));
      return;
    }
    // aria-* and microdata's content take "true" and "false" (HTML's boolean attributes do not).
    if (typeof value === 'boolean' && (name.startsWith('aria-') || name === 'content')) node.setAttribute(name, String(value));
    else if (value == null || value === false) node.removeAttribute(name);
    else node.setAttribute(name, value === true ? '' : String(value));
  };
  /** Whether an Edit here has had runs (its mirror): the host's other calls look for mirrors only then. */
  let mirrored = false;
  /** This host, as the mirrors it makes know it (`forget` lets them go on close). */
  const self = {};
  /** Anchor names count per host, so a view renders the same markup direct and through a worker. */
  let edits = 0;
  /** The application root's id, for the anchors' and state classes' names (a host with none takes a number of its document). */
  let named = '';
  /**
   * This host's name: its root's id, or `_n` for the n-th host without one in
   * its document, which no root id (`[a-z][a-z0-9-]*`) can take.
   */
  const own = () => {
    if (named === '') {
      const n = (hosts.get(doc) ?? 0) + 1;
      hosts.set(doc, n);
      named = `_${n}`;
    }
    return named;
  };
  /**
   * An Edit's `runs`: its mirror, made on the first list given.
   * @param {any} node @param {any} value
   */
  const edited = (node, value) => {
    let m = node[MIRROR];
    if (m === undefined) {
      if (!Array.isArray(value)) return;
      mirrored = true;
      m = node[MIRROR] = new Mirror(node, `--ren-${own()}-edit-${++edits}`, self);
      // Laid out (and each size after): the field's style and box are known.
      const Observer = node.ownerDocument?.defaultView?.ResizeObserver;
      if (typeof Observer === 'function') (fields ??= new Observer((/** @type {any[]} */ entries) => { for (const e of entries) e.target[MIRROR]?.sync(); })).observe(node);
    }
    m.set(value);
  };
  /** Watches the fields of mirrors. @type {any} */
  let fields = null;
  const H = /** @type {Host} */ ({
    element(tag, props, parent) {
      const role = PRIMITIVES[tag];
      if (role !== undefined) {
        const multiline = tag === 'Edit' && props != null && typeof props.lines === 'number' && props.lines > 1;
        const node = role === 'svg' ? doc.createElementNS(SVG, 'svg') : doc.createElement(multiline ? 'textarea' : role);
        if (multiline) {
          node.rows = props.lines;
          // Its width is the theme's entry (min-width), not 20 columns: as an input's size.
          node.setAttribute('cols', '1');
        }
        roles.set(node, tag);
        // An Edit takes no children: a flag on the node, cheaper than a lookup per insert.
        if (tag === 'Edit') {
          node[LEAF] = true;
          // Its caret's drawn row, as the canvases' Edit answers it.
          node.caretRow = caretRow;
        }
        // An image the browser would drag natively (its ghost takes the pointer from a swipe): the canvases drag none.
        else if (tag === 'Image') node.setAttribute('draggable', 'false');
        node.setAttribute('data-ren', tag);
        node.style.cssText = flow === null ? BASES[tag] : POSITIONED_BASES[tag];
        if (flow !== null) {
          const item = flow.node(tag);
          items.set(node, item);
          elements.set(item, node);
          if (multiline) flow.set(item, 'lines', props.lines);
        }
        // An Edit's width comes from the theme (min-width in the sheet), not from its size.
        if (tag === 'Edit') {
          node.setAttribute('size', '1');
          if (multiline && flow === null) {
            // Rows are a line high, the first where a one-line field's text sits.
            node.style.height = rowsHigh(props.lines);
            node.style.paddingBlock = rowsPad((node[EDGE] = '1px'));
          }
        }
        return node;
      }
      // The namespace the parent it goes into gives it, as the HTML parser reads markup.
      const ns = namespaceOf(tag, SHARED_TAGS.has(tag) || MATH_TAGS.has(tag) ? spaceOf(parent) : 0);
      return ns === null ? doc.createElement(tag) : doc.createElementNS(ns, tag);
    },
    text: text => doc.createTextNode(text),
    content(node, text) {
      // No read first: reading data copies the string out of the DOM, and ren-core
      // writes only changed text (bindings compare with the value shown).
      node.data = text;
      if (flow !== null) {
        const item = items.get(node);
        if (item !== undefined) flow.content(item, text);
      }
    },
    set(node, name, value, previous) {
      if (name === 'runs' && roles.get(node) === 'Edit') {
        if (flow !== null) flow.set(items.get(node), name, value);
        edited(node, value);
        return;
      }
      put(node, name, value, previous);
      // A value, a secret, `hidden` or a style changes what an Edit's mirror shows.
      if (mirrored && node[MIRROR] !== undefined) node[MIRROR].sync();
    },
    listen(node, name, handler) {
      if (name === 'resize') return sized(node, handler);
      if (name === 'keys') return rooted(node, handler);
      if (name === 'scrolls') return scrolled(node, handler);
      if (name === 'move') return moving(node, handler);
      // A primitive's drop and drag are ren-core's (`{ files }`, `{ files, types }`); an HTML element keeps the DOM's own.
      if (name === 'drop' && roles.has(node)) return dropped(node, handler);
      if ((name === 'dragenter' || name === 'dragover' || name === 'dragleave') && roles.has(node)) return dragging(node, name, handler);
      if (name === 'dragstart' && roles.has(node)) {
        // The application drags it: its drags start (undrag).
        node[DRAGS] = true;
        node.addEventListener(name, handler);
        return () => {
          node[DRAGS] = false;
          node.removeEventListener(name, handler);
        };
      }
      // Only change and submit depend on the role (an Edit's).
      const role = name === 'change' || name === 'submit' ? (roles.get(node) ?? '') : '';
      const event = eventOf(role, name);
      /** @param {any} e */
      let listener = handler;
      if (role === 'Edit' && name === 'change') listener = e => handler({ value: e.target.value, event: e });
      else if (role === 'Edit' && name === 'submit')
        listener = e => {
          if (e.key === 'Enter') handler({ value: e.target.value, event: e });
        };
      if (roots.size > 0 && DELEGATED.has(event)) {
        const key = keyOf(event);
        // One delegated handler per node and type; a second listens directly.
        if (node[key] == null) {
          node[key] = listener;
          return null;
        }
      }
      node.addEventListener(event, listener, activeFor(event));
      return () => node.removeEventListener(event, listener);
    },
    delegate(node, name, handler, runner) {
      // An Edit's change and submit wrap the event: those listen.
      if (roots.size === 0) return false;
      if (name !== lastName) {
        if ((name === 'change' || name === 'submit') && roles.get(node) === 'Edit') return false;
        const event = eventOf('', name);
        if (!DELEGATED.has(event)) return false;
        lastKey = keyOf(event);
        lastRun = /** @type {symbol} */ (runs.get(event));
        lastName = name;
      } else if ((name === 'change' || name === 'submit') && roles.get(node) === 'Edit') return false;
      const key = /** @type {symbol} */ (lastKey);
      if (node[key] != null) return false;
      node[key] = handler;
      node[/** @type {symbol} */ (lastRun)] = runner;
      return true;
    },
    unlisten(node, name) {
      const event = eventOf(name === 'change' || name === 'submit' ? (roles.get(node) ?? '') : '', name);
      const key = keys.get(event);
      if (key !== undefined) {
        node[key] = null;
        node[/** @type {symbol} */ (runs.get(event))] = null;
      }
    },
    attach(target) {
      const count = roots.get(target) ?? 0;
      roots.set(target, count + 1);
      if (count === 0) {
        for (const event of keys.keys()) target.addEventListener(event, dispatch, activeFor(event));
        target.addEventListener('dragstart', undrag);
        if (!behavior.menu || !behavior.editMenu) target.addEventListener('contextmenu', unmenu);
        if (!behavior.selectAll) guards.set(target, unselect(target));
      }
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        const left = /** @type {number} */ (roots.get(target)) - 1;
        if (left > 0) roots.set(target, left);
        else {
          roots.delete(target);
          for (const event of keys.keys()) target.removeEventListener(event, dispatch);
          target.removeEventListener('dragstart', undrag);
          target.removeEventListener('contextmenu', unmenu);
          guards.get(target)?.();
          guards.delete(target);
          // A host without a root put its state sheet in the document: its
          // last view gone, the sheet goes too (a root's goes on close).
          if (roots.size === 0 && !opened && stateSheet !== null) {
            stateSheet.parentNode?.removeChild(stateSheet);
            stateSheet = null;
            states.clear();
            composed.clear();
            made.clear();
            users.clear();
            sweepAt = COMPOSED;
          }
        }
      };
    },
    clear(parent, first, last) {
      // The last node's mirror goes with it.
      if (mirrored && last[MIRROR] !== undefined && last.nextSibling === last[MIRROR].box) last = last[MIRROR].box;
      release(parent, first, last);
      if (flow !== null)
        for (let n = first; n !== null; n = n.nextSibling) {
          unplace(parent, n);
          if (n === last) break;
        }
      if (parent.firstChild === first && parent.lastChild === last) parent.textContent = '';
      else {
        const range = doc.createRange();
        range.setStartBefore(first);
        range.setEndAfter(last);
        range.deleteContents();
      }
    },
    fill(element, text, keep) {
      // A text that stays bound is made and kept; a static one is set.
      if (!keep) {
        element.textContent = text;
        if (flow !== null && element.firstChild !== null) place(element, element.firstChild, null);
        return null;
      }
      const node = doc.createTextNode(text);
      element.appendChild(node);
      if (flow !== null) place(element, node, null);
      return node;
    },
    clone(plan, _values, parent) {
      // The last plan cloned, then this document's templates. A template whose root takes the
      // namespace of where it goes (an <a> in an <svg>) is kept per namespace of the parent.
      let template = plan === lastPlan && doc === lastDoc && (!lastTakes || spaceOf(parent) === lastSpace) ? lastTemplate : undefined;
      if (template === undefined) {
        const takes = takesSpace(plan.tree[0]);
        const space = takes ? spaceOf(parent) : 0;
        let byPlan = templates.get(doc);
        if (byPlan === undefined) templates.set(doc, (byPlan = new WeakMap()));
        const key = space === 0 ? plan : spacedKey(plan, space);
        template = byPlan.get(key);
        if (template === undefined) {
          template = skeleton(H, plan, undefined, parent)[0];
          byPlan.set(key, template);
        }
        lastPlan = plan;
        lastDoc = doc;
        lastTakes = takes;
        lastSpace = space;
        lastTemplate = template;
      }
      const root = template.cloneNode(true);
      const refs = plan.refs;
      const out = new Array(refs.length);
      out[0] = root;
      // Reach the held nodes by the plan's path: the fewest DOM steps.
      const path = plan.path;
      for (let r = 1, i = 0; r < refs.length; r++, i += 4) {
        let node = out[path[i]];
        if (path[i + 1] === 1) node = node.firstChild;
        for (let k = path[i + 2]; k > 0; k--) node = node.nextSibling;
        out[r] = node;
      }
      return out;
    },
    insert(parent, child, before) {
      if (parent[LEAF] === true) return;
      parent.insertBefore(child, before);
      // A nested root's host element: what this root's behavior turns off stops at it, unless it sets its own.
      if (switched.length > 0 && child.nodeType === 1 && child.hasAttribute('data-ren-root'))
        for (const [, , on] of switched) for (const name in on) if (child.style.getPropertyValue(name) === '') child.style.setProperty(name, on[name]);
      if (parent[CHOSEN] !== undefined || parent.localName === 'optgroup') choose(selectOf(parent));
      if (flow !== null) place(parent, child, before);
      // An Edit's mirror follows it, right after it.
      if (mirrored && child[MIRROR] !== undefined) child[MIRROR].sync();
      // Mirrors whose fields came in with this child (built out of the document, by any host) show now.
      if (waiting.size > 0 && child.isConnected) wake();
    },
    remove(parent, child) {
      if (child.parentNode !== parent) return;
      // The focus trap around a removed focused element takes the focus back.
      const trap = traps > 0 ? trapAround(parent, child) : null;
      release(parent, child, child);
      if (flow !== null) unplace(parent, child);
      if (mirrored && child[MIRROR] !== undefined && child[MIRROR].box.parentNode === parent) parent.removeChild(child[MIRROR].box);
      parent.removeChild(child);
      if (trap !== null) refocus(trap);
    },
    marker: () => doc.createTextNode(''),
    parent: node => node.parentNode,
    // ren-core never sees a mirror: the node after an Edit is the one after its mirror.
    next: node => (mirrored && node[MIRROR] !== undefined && node.nextSibling === node[MIRROR].box ? node[MIRROR].box.nextSibling : node.nextSibling),
    owns: value => value != null && typeof value === 'object' && typeof value.nodeType === 'number',
    layer: () => container ?? doc.body,
    kind,
    // A <Root> nested in this view renders into the light DOM by default.
    nest: () => make(doc, {}, null),
    open(host, id) {
      if (opened) throw new Error(`REN ${kind}: a renderer serves one root; make one per root`);
      if (host == null) throw new Error(`REN ${kind}: a root needs a host element`);
      opened = true;
      named = id;
      element = host;
      doc = host.ownerDocument;
      host.setAttribute('data-ren-root', id);
      tokens(host);
      typeset(host, id);
      for (const [, off] of switched) for (const name in off) host.style.setProperty(name, off[name]);
      const text = options.styles === false ? '' : sheet(id, mode !== null, typeof options.styles === 'string' ? options.styles : '', behavior);
      if (mode === null) {
        container = host;
        if (text !== '') {
          style = doc.createElement('style');
          style.setAttribute('data-ren-style', id);
          style.textContent = text;
          host.insertBefore(style, host.firstChild);
        }
        return container;
      }
      const shadow = host.attachShadow({ mode });
      container = shadow;
      if (text !== '') {
        // A constructable stylesheet adopted by this shadow root, or a
        // <style> inside it where constructable sheets are missing.
        const Sheet = doc.defaultView?.CSSStyleSheet;
        if (typeof Sheet === 'function' && 'adoptedStyleSheets' in shadow) {
          adopted = new Sheet();
          adopted.replaceSync(text);
          shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, adopted];
        } else {
          style = doc.createElement('style');
          style.textContent = text;
          shadow.appendChild(style);
        }
      }
      return container;
    },
    close() {
      if (!opened || closed) return;
      closed = true;
      // Its mirrors still waiting for their fields are not kept.
      forget(self);
      if (watcher !== null) watcher.disconnect();
      watcher = null;
      if (fields !== null) fields.disconnect();
      fields = null;
      // No container when attachShadow threw: the host is let go, and its error comes through.
      const box = container;
      if (box !== null) {
        while (box.firstChild) box.removeChild(box.firstChild);
        if (adopted !== null) box.adoptedStyleSheets = box.adoptedStyleSheets.filter((/** @type {any} */ s) => s !== adopted);
      }
      element.removeAttribute('data-ren-root');
      for (const key in theme) element.style.removeProperty(`--ren-${key}`);
      element.style.removeProperty('--ren-scrollbar');
      for (const name of ['font-family', '--ren-mono', 'font-kerning', 'font-variant-ligatures']) if (options.font != null || options.mono != null) element.style.removeProperty(name);
      for (const [, off] of switched) for (const name in off) element.style.removeProperty(name);
      for (const face of faces) doc.fonts?.delete(face);
      faces = [];
      style = adopted = null;
    },
  });
  /**
   * The viewport (ren-core's `$viewport`, `$media`): the window's inner
   * size, as CSS media queries read it, and its color scheme and motion
   * preferences; now, then on each resize or change. Without a window, 0 × 0.
   * @param {(width: number, height: number, flags: number) => void} report
   */
  H.viewport = report => {
    const win = doc.defaultView;
    if (win == null) {
      report(0, 0, 0);
      return () => {};
    }
    const dark = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
    const still = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const tell = () => report(win.innerWidth ?? 0, win.innerHeight ?? 0, (dark?.matches ? 1 : 0) | (still?.matches ? 2 : 0));
    win.addEventListener('resize', tell);
    dark?.addEventListener?.('change', tell);
    still?.addEventListener?.('change', tell);
    tell();
    return () => {
      win.removeEventListener('resize', tell);
      dark?.removeEventListener?.('change', tell);
      still?.removeEventListener?.('change', tell);
    };
  };
  // A new theme at once: the root's host element gets its tokens, so
  // everything inside follows (as with any custom property); the view and
  // all state stay.
  H.setTheme = (/** @type {import('ren-core/host').Tokens} */ next) => {
    theme = new Theme(next);
    if (element !== null) tokens(element);
    // Mirrors copy their fields' computed text: again under the new tokens.
    if (mirrored && container !== null) for (const n of container.querySelectorAll('[data-ren-runs]')) n[MIRROR]?.sync();
    // Laid out by an engine: on the new theme's metrics, at once.
    if (flow !== null && typeof flow.retheme === 'function') {
      flow.retheme(next);
      H.present?.();
    }
  };
  if (flow !== null) {
    // Every primitive needs its item: templates are built through the host
    // calls, not cloned.
    delete H.clone;
    H.present = () => flow.arrange(moved => {
      for (const item of moved) {
        const el = elements.get(item);
        if (el === undefined) continue;
        const [x, y] = flow.offset(item);
        const style = el.style;
        style.left = `${x}px`;
        style.top = `${y}px`;
        style.width = `${item.w}px`;
        style.height = `${item.h}px`;
      }
    });
  }
  return H;
}

/**
 * A Host over `document`, rendering into the light DOM.
 * @param {any} [document]
 * @param {Options} [options]
 * @returns {Host}
 */
export function $dom(document = /** @type {any} */ (globalThis).document, options = {}) {
  return make(document, options, null);
}

/**
 * A Host rendering into a shadow root that an application root attaches to
 * its host element (`mode` 'open' by default). Its stylesheet is adopted by
 * that shadow root, so nothing reaches the document and nothing outside
 * styles the view. It needs a Root (or `open`) before it builds nodes.
 * @param {ShadowOptions} [options]
 * @returns {Host}
 */
export function $shadow(options = {}) {
  return make(options.document ?? /** @type {any} */ (globalThis).document, options, options.mode ?? 'open');
}

/**
 * Renders `view()` into a DOM `container`; returns the dispose function.
 * @param {() => any} view
 * @param {any} container
 * @param {import('ren-core/host').Options} [options]
 */
export function render(view, container, options) {
  return mount($dom(container.ownerDocument), view, container, options);
}
