import { describe, expect, it } from 'vitest';
import { formatTargetAddress, parseTargetAddress } from '../src/utils/target-address.js';

describe('target addresses', () => {
  it('parses default and named target addresses', () => {
    expect(parseTargetAddress('webhook')).toEqual({
      adapter: 'webhook'
    });
    expect(parseTargetAddress('qq:ops_group-1')).toEqual({
      adapter: 'qq',
      target: 'ops_group-1'
    });
    expect(formatTargetAddress('qq', 'ops')).toBe('qq:ops');
  });

  it.each([undefined, '', ':ops', 'qq:', 'qq:ops:extra', 'bad.name', 'qq:bad.name'])(
    'rejects invalid address %s',
    (address) => {
      expect(() => parseTargetAddress(address)).toThrowError(
        expect.objectContaining({ code: 'INVALID_TARGET' })
      );
    }
  );
});
