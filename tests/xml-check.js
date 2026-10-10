// A small well-formedness check for the feed tests (Node has no XML parser built
// in and the project has no test dependencies). It covers what these feeds use:
// one root element, balanced tags, quoted attributes, only the five predefined
// entities (or numeric references), and no characters XML 1.0 forbids. It throws
// with a message on the first problem.
const FORBIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/;
const TOKEN = /<\?xml[^>]*\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/?)>|[^<]+|</g;

export function assertWellFormed(xml) {
  if (FORBIDDEN.test(xml)) throw new Error('forbidden character in XML');
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) throw new Error('missing XML declaration');

  const stack = [];
  let roots = 0;

  for (const match of xml.matchAll(TOKEN)) {
    const [token, closing, name, attributes, selfClosing] = match;

    if (token === '<') throw new Error('stray "<"');

    if (name === undefined) {
      if (token.startsWith('<?xml')) continue;
      if (ENTITY.test(token)) throw new Error(`bad "&" in text: ${token.slice(0, 40)}`);
      if (stack.length === 0 && token.trim() !== '') throw new Error('text outside the root element');
      continue;
    }

    if (ENTITY.test(attributes)) throw new Error(`bad "&" in an attribute of <${name}>`);

    if (closing) {
      if (stack.pop() !== name) throw new Error(`unbalanced </${name}>`);
    } else {
      if (stack.length === 0) roots += 1;
      if (!selfClosing) stack.push(name);
    }
  }

  if (stack.length) throw new Error(`unclosed <${stack.at(-1)}>`);
  if (roots !== 1) throw new Error(`expected one root element, found ${roots}`);
}
