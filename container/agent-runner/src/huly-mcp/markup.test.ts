import { describe, it, expect } from 'bun:test';

import { markdownToProseMirror } from './markup.js';

type Node = Record<string, unknown>;

describe('markdownToProseMirror', () => {
  it('wraps a plain line in a paragraph', () => {
    const doc = markdownToProseMirror('hello world') as { type: string; content: Node[] };
    expect(doc.type).toBe('doc');
    expect(doc.content[0].type).toBe('paragraph');
    expect((doc.content[0].content as Node[])[0]).toEqual({ type: 'text', text: 'hello world' });
  });

  it('turns # into a heading with the right level', () => {
    const doc = markdownToProseMirror('### Title') as { content: Node[] };
    expect(doc.content[0].type).toBe('heading');
    expect((doc.content[0].attrs as Node).level).toBe(3);
  });

  it('groups consecutive - lines into a single bulletList', () => {
    const doc = markdownToProseMirror('- one\n- two') as { content: Node[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('bulletList');
    expect(doc.content[0].content as Node[]).toHaveLength(2);
  });

  it('marks inline bold, code, and links', () => {
    const doc = markdownToProseMirror('a **b** `c` [d](http://x)') as { content: Node[] };
    const spans = (doc.content[0].content as Node[]).filter((n) => Array.isArray((n as Node).marks));
    const markTypes = spans.map((n) => ((n as Node).marks as Node[])[0].type);
    expect(markTypes).toContain('bold');
    expect(markTypes).toContain('code');
    expect(markTypes).toContain('link');
  });

  it('never yields empty doc content', () => {
    const doc = markdownToProseMirror('') as { content: Node[] };
    expect(doc.content.length).toBeGreaterThan(0);
  });

  it('does not treat snake_case underscores as italics', () => {
    const doc = markdownToProseMirror('run my_local_var now') as { content: Node[] };
    const spans = doc.content[0].content as Node[];
    // No italic mark should appear; the whole line stays one plain text run.
    expect(spans.some((n) => Array.isArray((n as Node).marks))).toBe(false);
  });
});
