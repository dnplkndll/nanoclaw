/**
 * Unit tests for the Huly adapter's pure helpers — the echo-loop guard,
 * mention detection, and ProseMirror flattening — exercised without a server.
 */
import { describe, it, expect } from 'vitest';

import { selectFresh, mentionsBot, plainText } from './huly.js';

const msg = (id: string, createdOn: number, createdBy: string) => ({ _id: id, createdOn, createdBy });

describe('selectFresh', () => {
  it('drops messages at or below the high-water mark', () => {
    const out = selectFresh([msg('a', 5, 'u'), msg('b', 15, 'u')], 10, 'bot');
    expect(out.map((m) => m._id)).toEqual(['b']);
  });

  it("excludes the bot's own messages (echo-loop guard)", () => {
    const out = selectFresh([msg('a', 20, 'bot'), msg('b', 21, 'u')], 10, 'bot');
    expect(out.map((m) => m._id)).toEqual(['b']);
  });

  it('returns oldest-first', () => {
    const out = selectFresh([msg('a', 30, 'u'), msg('b', 20, 'u')], 10, 'bot');
    expect(out.map((m) => m._id)).toEqual(['b', 'a']);
  });

  it('with an empty botSocialId does NOT special-case — caller must guard', () => {
    // Documents the failure mode the setup() hard-fail prevents: an empty id
    // would let a bot-authored message through.
    const out = selectFresh([msg('a', 20, '')], 10, '');
    expect(out).toHaveLength(0); // author '' === botSocialId '' → filtered
    const botAuthored = selectFresh([msg('a', 20, 'realbot')], 10, '');
    expect(botAuthored).toHaveLength(1); // would echo — why setup refuses empty id
  });
});

describe('mentionsBot', () => {
  const doc = (id: string) =>
    JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'reference', attrs: { id, label: 'Bot' } },
            { type: 'text', text: ' hi' },
          ],
        },
      ],
    });

  it('matches a reference node to the bot person ref', () => {
    expect(mentionsBot(doc('person-1'), 'person-1')).toBe(true);
  });

  it('does not match a different person', () => {
    expect(mentionsBot(doc('person-2'), 'person-1')).toBe(false);
  });

  it('is false when the bot ref is empty', () => {
    expect(mentionsBot(doc('person-1'), '')).toBe(false);
  });

  it('is false on malformed json', () => {
    expect(mentionsBot('{not json', 'person-1')).toBe(false);
  });
});

describe('plainText', () => {
  it('flattens text and reference labels', () => {
    const j = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'reference', attrs: { label: 'Bot' } },
            { type: 'text', text: ' please' },
          ],
        },
      ],
    });
    expect(plainText(j)).toBe('@Bot please');
  });

  it('falls back to the raw string on malformed json', () => {
    expect(plainText('hello')).toBe('hello');
  });
});
