import { describe, expect, it } from 'vitest';

import { isJsonValue } from '../src/utils/json.js';
import { isRecord } from '../src/utils/record.js';

describe('webhook JSON utilities', () => {
  it('recognizes only finite JSON-shaped values', () => {
    expect(isJsonValue({ nested: [null, true, 1, 'value'] })).toBe(true);
    expect(isJsonValue({ value: Number.NaN })).toBe(false);
    expect(isJsonValue(new Date('1979-05-27T07:32:00Z'))).toBe(false);
    expect(isJsonValue({ nested: new Date('1979-05-27T07:32:00Z') })).toBe(false);
  });
});

describe('webhook record utilities', () => {
  it('recognizes records', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(new Date('1979-05-27T07:32:00Z'))).toBe(false);
  });
});
