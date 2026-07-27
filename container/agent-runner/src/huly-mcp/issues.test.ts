import { describe, it, expect } from 'bun:test';

import { statusWord, priorityWord } from './tools/issues.js';

describe('statusWord', () => {
  it('maps the real Huly status categories to words', () => {
    expect(statusWord('task:statusCategory:UnStarted')).toBe('backlog');
    expect(statusWord('task:statusCategory:ToDo')).toBe('todo');
    expect(statusWord('task:statusCategory:Active')).toBe('inprogress');
    expect(statusWord('task:statusCategory:Won')).toBe('done');
    expect(statusWord('task:statusCategory:Lost')).toBe('cancelled');
  });

  it('returns unknown for an unmapped or missing category', () => {
    expect(statusWord(undefined)).toBe('unknown');
    expect(statusWord('task:statusCategory:Nope')).toBe('unknown');
  });
});

describe('priorityWord', () => {
  it('maps IssuePriority ints to words', () => {
    expect(priorityWord(0)).toBe('nopriority');
    expect(priorityWord(1)).toBe('urgent');
    expect(priorityWord(2)).toBe('high');
    expect(priorityWord(3)).toBe('medium');
    expect(priorityWord(4)).toBe('low');
  });

  it('defaults to nopriority for undefined', () => {
    expect(priorityWord(undefined)).toBe('nopriority');
  });
});
