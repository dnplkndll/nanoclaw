/**
 * Minimal Markdown → ProseMirror conversion for Huly rich bodies.
 *
 * Huly stores rich text as a ProseMirror document (JSON). We accept plain
 * Markdown from the agent and produce a document good enough for the common
 * cases: paragraphs, headings (#..######), bullet lists (-/*), and inline
 * `code`, **bold**, _italic_, and [links](url). Anything fancier degrades to
 * plain paragraphs rather than failing.
 */

type Node = Record<string, unknown>;

function inline(text: string): Node[] {
  const nodes: Node[] = [];
  // Order matters: links first, then code, bold, italic. Underscore-italics
  // require surrounding boundaries so snake_case identifiers aren't mangled.
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])_[^_]+_(?![A-Za-z0-9]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, marks?: Node[]) => {
    if (t.length === 0) return;
    nodes.push(marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
  };
  while ((m = pattern.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) push(lm[1], [{ type: 'link', attrs: { href: lm[2], target: '_blank' } }]);
    } else if (tok.startsWith('`')) {
      push(tok.slice(1, -1), [{ type: 'code' }]);
    } else if (tok.startsWith('**')) {
      push(tok.slice(2, -2), [{ type: 'bold' }]);
    } else if (tok.startsWith('_')) {
      push(tok.slice(1, -1), [{ type: 'italic' }]);
    }
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return nodes.length > 0 ? nodes : [{ type: 'text', text: text || ' ' }];
}

/** Build a ProseMirror doc object from a Markdown string. */
export function markdownToProseMirror(markdown: string): Node {
  const content: Node[] = [];
  const lines = (markdown ?? '').split('\n');
  let bullets: Node[] | null = null;

  const flushBullets = () => {
    if (bullets && bullets.length > 0) content.push({ type: 'bulletList', content: bullets });
    bullets = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushBullets();
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: inline(heading[2]) });
    } else if (bullet) {
      bullets ??= [];
      bullets.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(bullet[1]) }] });
    } else if (line.trim() === '') {
      flushBullets();
    } else {
      flushBullets();
      content.push({ type: 'paragraph', content: inline(line) });
    }
  }
  flushBullets();
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}
