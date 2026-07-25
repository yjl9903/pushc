import { describe, expect, it } from 'vitest';

import { cloneJson, isJsonValue, toNullPrototypeJson } from '../src/utils/json.js';
import { emptyRecord, isRecord, recordFromMap } from '../src/utils/record.js';

describe('webhook JSON utilities', () => {
  it('recognizes only finite JSON-shaped values', () => {
    expect(isJsonValue({ nested: [null, true, 1, 'value'] })).toBe(true);
    expect(isJsonValue({ value: Number.NaN })).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
  });

  it('deep-clones objects and materializes null-prototype records', () => {
    const source = { nested: { value: 'original' } };
    const cloned = cloneJson(source) as { nested: { value: string } };
    source.nested.value = 'changed';

    expect(cloned.nested.value).toBe('original');
    expect(Object.getPrototypeOf(cloned)).toBeNull();
    expect(Object.getPrototypeOf(cloned.nested)).toBeNull();
    expect(Object.getPrototypeOf(toNullPrototypeJson({ value: true }))).toBeNull();
  });
});

describe('webhook record utilities', () => {
  it('recognizes records and builds isolated null-prototype copies', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);

    const empty = emptyRecord<string>();
    const values = recordFromMap(new Map([['key', 'value']]));
    expect(Object.getPrototypeOf(empty)).toBeNull();
    expect(Object.getPrototypeOf(values)).toBeNull();
    expect(values).toEqual({ key: 'value' });
  });
});
