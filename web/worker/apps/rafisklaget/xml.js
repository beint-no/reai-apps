// @ts-check
import { HttpError } from '../../lib/http.js';

/**
 * @typedef {{ name: string, attrs: Record<string, string>, children: XmlNode[], text: string }} XmlNode
 */

/** @type {Record<string, string>} */
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    const v = ENTITIES[e];
    if (v === undefined) throw new HttpError(502, `Unknown XML entity &${e}; in the response.`);
    return v;
  });
}

/** @param {string} qname */
const local = (qname) => qname.slice(qname.indexOf(':') + 1);

/**
 * Parses a small, well-formed XML document into a tree. Namespace prefixes are dropped from element and
 * attribute names (the documents used here have no clashing local names). Comments, processing
 * instructions and the declaration are skipped; CDATA becomes text. Throws on malformed input.
 * @param {string} xml
 * @returns {XmlNode}
 */
export function parseXml(xml) {
  /** @type {XmlNode} */
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  /** @type {XmlNode[]} */
  const stack = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const top = /** @type {XmlNode} */ (stack.at(-1));
    if (lt < 0) {
      if (xml.slice(i).trim()) throw new HttpError(502, 'Malformed XML: text after the root element.');
      break;
    }
    if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new HttpError(502, 'Malformed XML: unterminated comment.');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new HttpError(502, 'Malformed XML: unterminated CDATA.');
      top.text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new HttpError(502, 'Malformed XML: unterminated declaration.');
      i = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      throw new HttpError(502, 'XML document type declarations are not accepted.');
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end < 0) throw new HttpError(502, 'Malformed XML: unterminated end tag.');
      const name = local(xml.slice(lt + 2, end).trim());
      if (stack.length < 2 || top.name !== name) throw new HttpError(502, `Malformed XML: unexpected </${name}>.`);
      stack.pop();
      i = end + 1;
    } else {
      const m = /^<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(xml.slice(lt, Math.min(n, lt + 4096)));
      if (!m) throw new HttpError(502, 'Malformed XML: invalid start tag.');
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const a of (m[2] ?? '').matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const key = /** @type {string} */ (a[1]);
        if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
        attrs[local(key)] = decodeEntities(a[2] ?? a[3] ?? '');
      }
      /** @type {XmlNode} */
      const node = { name: local(/** @type {string} */ (m[1])), attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[3]) stack.push(node);
      i = lt + m[0].length;
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new HttpError(502, 'Malformed XML: the document is incomplete.');
  return /** @type {XmlNode} */ (root.children[0]);
}

/**
 * First direct child with this local name.
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @returns {XmlNode | undefined}
 */
export function child(node, name) {
  return node?.children.find((c) => c.name === name);
}

/**
 * All direct children with this local name.
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @returns {XmlNode[]}
 */
export function children(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/**
 * First descendant (depth first, including the node itself) with this local name.
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @returns {XmlNode | undefined}
 */
export function find(node, name) {
  if (!node) return undefined;
  if (node.name === name) return node;
  for (const c of node.children) {
    const hit = find(c, name);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Trimmed text of a direct child, or ''.
 * @param {XmlNode | undefined} node
 * @param {string} name
 */
export function text(node, name) {
  return (child(node, name)?.text ?? '').trim();
}
