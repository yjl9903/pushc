import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';

describe('public API', () => {
  it('exports initialization and official toolkit APIs without CLI commands', () => {
    expect(publicApi).toHaveProperty('PushClient');
    expect(publicApi).toHaveProperty('PushAdapters');
    expect(publicApi).toHaveProperty('WebhookAdapter');
    expect(publicApi).toHaveProperty('NapCatAdapter');
    expect(publicApi).toHaveProperty('makePushClient');
    expect(publicApi).toHaveProperty('findConfigPath');
    expect(publicApi).toHaveProperty('normalizeConfigPath');
    expect(publicApi).toHaveProperty('parsePushConfig');
    expect(publicApi).not.toHaveProperty('runCli');
  });
});
