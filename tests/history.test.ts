import { describe, expect, it } from 'vitest';
import { parseHistory } from '../src/core/history';
import { createNote } from '../src/core/identity';

const record = () => ({ ...createNote(), docId: '20261010000000-doc0001',
  target: { notebook: '20261010000000-book001', path: '/Inbox/Note' }, summary: 'valid note' });
describe('stored history validation', () => {
  it('skips malformed records without consuming valid record slots', () => {
    const valid = record(), another = record();
    const malformed = [null, 123, {}, { ...record(), id: {} }, { ...record(), blockId: {} },
      { ...record(), docId: 123 }, { ...record(), updatedAt: 'yesterday' }, { ...record(), target: null },
      { ...record(), target: { notebook: valid.target.notebook, path: 123 } },
      { ...record(), target: { notebook: {}, path: '/Inbox' } }];
    expect(parseHistory([...malformed, valid, another], 2).map(item => item.id)).toEqual([valid.id, another.id]);
    expect(parseHistory({}, 20)).toEqual([]);
  });
  it('deduplicates, supports legacy records, and only retains display metadata', () => {
    const valid = record(), legacy = { ...record(), target: undefined, summary: { invalid: true } };
    const result = parseHistory([{ ...valid, summary: '# Title\nprivate body' }, valid, legacy], 20);
    expect(result).toHaveLength(2); expect(result[0].summary).toBe('# Title');
    expect(result[0]).not.toHaveProperty('text'); expect(result[0]).not.toHaveProperty('baseline');
    expect(result[1]).not.toHaveProperty('summary'); expect(result[1].target).toBeUndefined();
  });
});
