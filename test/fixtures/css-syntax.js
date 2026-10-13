// A model of CSS Syntax Level 3 (its tokenizer, section 4, and the rule
// parsing of section 5 a stylesheet needs), written from the standard for
// the tests: what a browser reads a stylesheet's text as. It keeps what the
// tests look at: each token's type and value, the parse errors that end a
// token early (a bad string, a bad url, the end inside a string, url or
// comment), and a stylesheet's rules with their preludes and blocks.

/**
 * @typedef {{ type: string, value: string, bad?: boolean }} Token
 * @typedef {{ prelude: Token[], block: Token[] | null }} Rule
 */

const isDigit = (/** @type {string} */ c) => c >= '0' && c <= '9';
const isHex = (/** @type {string} */ c) => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isWhitespace = (/** @type {string} */ c) => c === '\n' || c === '\t' || c === ' ';
const isNameStart = (/** @type {string} */ c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || (c !== '' && c.charCodeAt(0) >= 0x80);
const isName = (/** @type {string} */ c) => isNameStart(c) || isDigit(c) || c === '-';
const isNonPrintable = (/** @type {string} */ c) => c !== '' && (c.charCodeAt(0) <= 8 || c === '\u000b' || (c.charCodeAt(0) >= 0x0e && c.charCodeAt(0) <= 0x1f) || c === '\u007f');

/**
 * The tokens of a stylesheet's text, as CSS Syntax reads them.
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenize(text) {
  // 3.3: preprocessing.
  const s = text.replace(/\r\n?|\f/g, '\n').replace(/\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
  const n = s.length;
  let i = 0;
  const at = (/** @type {number} */ k) => (i + k < n ? s[i + k] : '');
  const validEscape = (/** @type {string} */ a, /** @type {string} */ b) => a === '\\' && b !== '\n';
  const startsIdent = (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ c) =>
    a === '-' ? isNameStart(b) || b === '-' || validEscape(b, c) : isNameStart(a) ? true : a === '\\' ? validEscape(a, b) : false;
  const startsNumber = (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ c) =>
    a === '+' || a === '-' ? isDigit(b) || (b === '.' && isDigit(c)) : a === '.' ? isDigit(b) : isDigit(a);
  /** 4.3.7: after the backslash. */
  const escape = () => {
    const c = at(0);
    if (c === '') return '�';
    i++;
    if (!isHex(c)) return c;
    let hex = c;
    while (hex.length < 6 && isHex(at(0))) hex += s[i++];
    if (isWhitespace(at(0))) i++;
    const code = parseInt(hex, 16);
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '�' : String.fromCodePoint(code);
  };
  /** 4.3.11 */
  const name = () => {
    let out = '';
    for (;;) {
      const c = at(0);
      if (isName(c)) {
        out += c;
        i++;
      } else if (validEscape(c, at(1))) {
        i++;
        out += escape();
      } else return out;
    }
  };
  /** 4.3.12 */
  const number = () => {
    let repr = '';
    if (at(0) === '+' || at(0) === '-') repr += s[i++];
    while (isDigit(at(0))) repr += s[i++];
    if (at(0) === '.' && isDigit(at(1))) {
      repr += s[i++];
      while (isDigit(at(0))) repr += s[i++];
    }
    if ((at(0) === 'e' || at(0) === 'E') && (isDigit(at(1)) || ((at(1) === '+' || at(1) === '-') && isDigit(at(2))))) {
      repr += s[i++];
      if (!isDigit(at(0))) repr += s[i++];
      while (isDigit(at(0))) repr += s[i++];
    }
    return repr;
  };
  /** 4.3.3 */
  const numeric = () => {
    const value = number();
    if (startsIdent(at(0), at(1), at(2))) return { type: 'dimension', value: value + name() };
    if (at(0) === '%') {
      i++;
      return { type: 'percentage', value };
    }
    return { type: 'number', value };
  };
  /** 4.3.14 */
  const badUrlRemnants = () => {
    for (;;) {
      const c = at(0);
      if (c === '') return;
      if (c === ')') {
        i++;
        return;
      }
      if (validEscape(c, at(1))) {
        i++;
        escape();
      } else i++;
    }
  };
  /** 4.3.6: after `url(` and its whitespace. @returns {Token} */
  const url = () => {
    let value = '';
    while (isWhitespace(at(0))) i++;
    for (;;) {
      const c = at(0);
      if (c === ')') {
        i++;
        return { type: 'url', value };
      }
      if (c === '') return { type: 'url', value, bad: true };
      if (isWhitespace(c)) {
        while (isWhitespace(at(0))) i++;
        if (at(0) === ')') {
          i++;
          return { type: 'url', value };
        }
        if (at(0) === '') return { type: 'url', value, bad: true };
        badUrlRemnants();
        return { type: 'bad-url', value, bad: true };
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) {
        badUrlRemnants();
        return { type: 'bad-url', value, bad: true };
      }
      if (c === '\\') {
        if (validEscape(c, at(1))) {
          i++;
          value += escape();
        } else {
          badUrlRemnants();
          return { type: 'bad-url', value, bad: true };
        }
        continue;
      }
      value += c;
      i++;
    }
  };
  /** 4.3.4 @returns {Token} */
  const identLike = () => {
    const value = name();
    if (value.toLowerCase() === 'url' && at(0) === '(') {
      i++;
      while (isWhitespace(at(0)) && isWhitespace(at(1))) i++;
      const next = isWhitespace(at(0)) ? at(1) : at(0);
      if (next === '"' || next === "'") return { type: 'function', value };
      return url();
    }
    if (at(0) === '(') {
      i++;
      return { type: 'function', value };
    }
    return { type: 'ident', value };
  };
  /** 4.3.5 @param {string} end @returns {Token} */
  const string = end => {
    let value = '';
    for (;;) {
      const c = at(0);
      if (c === '') return { type: 'string', value, bad: true };
      i++;
      if (c === end) return { type: 'string', value };
      if (c === '\n') {
        i--;
        return { type: 'bad-string', value, bad: true };
      }
      if (c === '\\') {
        if (at(0) === '') continue;
        if (at(0) === '\n') i++;
        else value += escape();
      } else value += c;
    }
  };
  /** @type {Token[]} */
  const tokens = [];
  while (i < n) {
    // 4.3.2: comments.
    if (at(0) === '/' && at(1) === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) {
        tokens.push({ type: 'comment', value: '', bad: true });
        break;
      }
      i = end + 2;
      continue;
    }
    const c = s[i];
    if (isWhitespace(c)) {
      while (isWhitespace(at(0))) i++;
      tokens.push({ type: 'whitespace', value: ' ' });
    } else if (c === '"' || c === "'") {
      i++;
      tokens.push(string(c));
    } else if (c === '#') {
      if (isName(at(1)) || validEscape(at(1), at(2))) {
        i++;
        tokens.push({ type: 'hash', value: name() });
      } else {
        i++;
        tokens.push({ type: 'delim', value: c });
      }
    } else if ('()[]{},:;'.includes(c)) {
      i++;
      tokens.push({ type: c, value: c });
    } else if (c === '+' || c === '.') {
      if (startsNumber(c, at(1), at(2))) tokens.push(numeric());
      else {
        i++;
        tokens.push({ type: 'delim', value: c });
      }
    } else if (c === '-') {
      if (startsNumber(c, at(1), at(2))) tokens.push(numeric());
      else if (at(1) === '-' && at(2) === '>') {
        i += 3;
        tokens.push({ type: 'CDC', value: '-->' });
      } else if (startsIdent(c, at(1), at(2))) tokens.push(identLike());
      else {
        i++;
        tokens.push({ type: 'delim', value: c });
      }
    } else if (c === '<') {
      if (at(1) === '!' && at(2) === '-' && at(3) === '-') {
        i += 4;
        tokens.push({ type: 'CDO', value: '<!--' });
      } else {
        i++;
        tokens.push({ type: 'delim', value: c });
      }
    } else if (c === '@') {
      if (startsIdent(at(1), at(2), at(3))) {
        i++;
        tokens.push({ type: 'at-keyword', value: name() });
      } else {
        i++;
        tokens.push({ type: 'delim', value: c });
      }
    } else if (c === '\\') {
      if (validEscape(c, at(1))) tokens.push(identLike());
      else {
        i++;
        tokens.push({ type: 'delim', value: c });
      }
    } else if (isDigit(c)) tokens.push(numeric());
    else if (isNameStart(c)) tokens.push(identLike());
    else {
      i++;
      tokens.push({ type: 'delim', value: c });
    }
  }
  return tokens;
}

const MIRROR = /** @type {Record<string, string>} */ ({ '{': '}', '[': ']', '(': ')', function: ')' });

/**
 * A stylesheet's rules (5.4.1, 5.4.2, 5.4.3): each qualified or at-rule's
 * prelude and block, its tokens at the block's own level and below. A rule
 * the text ends inside has `open` set.
 * @param {string} text
 * @returns {(Rule & { open: boolean, at: string | null })[]}
 */
export function rules(text) {
  const tokens = tokenize(text);
  let i = 0;
  /** A component value (5.4.7): a block or function whole, with what closes it; `open` when the end came first. */
  const component = (/** @type {Token[]} */ into) => {
    const t = tokens[i++];
    into.push(t);
    const close = MIRROR[t.type];
    if (close === undefined) return true;
    while (i < tokens.length) {
      if (tokens[i].type === close) {
        into.push(tokens[i++]);
        return true;
      }
      if (!component(into)) return false;
    }
    return false;
  };
  /** @type {(Rule & { open: boolean, at: string | null })[]} */
  const out = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'whitespace' || t.type === 'CDO' || t.type === 'CDC') {
      i++;
      continue;
    }
    const atName = t.type === 'at-keyword' ? t.value : null;
    if (atName !== null) i++;
    /** @type {Token[]} */
    const prelude = [];
    /** @type {Token[] | null} */
    let block = null;
    let open = true;
    while (i < tokens.length) {
      const u = tokens[i];
      if (atName !== null && u.type === ';') {
        i++;
        open = false;
        break;
      }
      if (u.type === '{') {
        i++;
        block = [];
        open = true;
        while (i < tokens.length) {
          if (tokens[i].type === '}') {
            i++;
            open = false;
            break;
          }
          if (!component(block)) break;
        }
        break;
      }
      if (!component(prelude)) break;
    }
    out.push({ prelude, block, open, at: atName });
  }
  return out;
}

/** Tokens as text again, near enough to compare: whitespace as one space. @param {Token[]} tokens */
export const text = tokens =>
  tokens
    .map(t =>
      t.type === 'hash' ? `#${t.value}` : t.type === 'at-keyword' ? `@${t.value}` : t.type === 'function' ? `${t.value}(` : t.type === 'string' ? JSON.stringify(t.value) : t.type === 'url' ? `url(${t.value})` : t.type === 'percentage' ? `${t.value}%` : t.value,
    )
    .join('')
    .trim();
