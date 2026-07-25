import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';

describe('public API', () => {
  it('exports core and composition APIs without concrete adapters or CLI commands', () => {
    expect(Object.keys(publicApi).sort()).toMatchInlineSnapshot(`
      [
        "PushAdapter",
        "PushAdapters",
        "PushClient",
        "PushError",
        "PushTargets",
        "findConfigPath",
        "formatDestination",
        "isDestinationName",
        "makePushRuntime",
        "normalizeConfigPath",
        "normalizeDestination",
        "parsePushConfig",
        "validateDestinationName",
      ]
    `);
  });
});
