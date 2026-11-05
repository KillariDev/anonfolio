import { afterEach, beforeEach, expect, test } from 'bun:test';
import { loadSettings, saveSettings, SETTINGS_KEY, validateSettings } from '../src/settings';

const gateway = '152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ';
const defaults = { gateways: [gateway], rpcUrls: ['https://rpc.example/'] };
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
test('settings normalize and deduplicate HTTPS URLs and support IPv6 gateways', () => {
  expect(validateSettings({ ...defaults, rpcUrls: [' https://rpc.example ', 'https://rpc.example/'], gateways: [gateway, gateway] })).toEqual(defaults);
  const ipv6 = gateway.replace('152.236.3.22', '[2001:db8::1]');
  expect(validateSettings({ ...defaults, gateways: [ipv6] }).gateways).toEqual([ipv6]);
});
test('invalid settings are rejected before changing saved settings', () => {
  expect(saveSettings(defaults)).toBe(true);
  for (const bad of [null, {}, { ...defaults, gateways: [] }, { ...defaults, rpcUrls: [] },
    ...['http://rpc.example', 'javascript:alert(1)', 'https://user:pass@rpc.example', 'https://rpc.example/#fragment', 'bad'].map(url => ({ ...defaults, rpcUrls: [url] })),
    ...['not-a-gateway', gateway.replace(':12298:', ':0:'), gateway.replace(':12298:', ':65536:'), gateway.replace('uEiC', 'uAAA'), 'host:443:invalid'].map(value => ({ ...defaults, gateways: [value] }))]) {
    expect(() => validateSettings(bad)).toThrow();
    expect(values.get(SETTINGS_KEY)).toBe(JSON.stringify(defaults));
  }
});
test('settings survive reload and restoring defaults only removes network overrides', () => {
  values.set('portfolio', 'unchanged');
  const settings = { ...defaults, rpcUrls: ['https://custom.example/key'] };
  expect(saveSettings(settings)).toBe(true);
  expect(loadSettings(defaults)).toEqual(settings);
  expect(saveSettings(null)).toBe(true);
  expect(loadSettings(defaults)).toEqual(defaults);
  expect(values.get('portfolio')).toBe('unchanged');
});
test('corrupt or blocked storage uses defaults and reports save failures', () => {
  for (const value of ['{broken', 'null', '{}', JSON.stringify({ ...defaults, rpcUrls: ['http://unsafe.example'] })]) {
    values.set(SETTINGS_KEY, value);
    expect(loadSettings(defaults)).toEqual(defaults);
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Blocked'); } });
  expect(loadSettings(defaults)).toEqual(defaults);
  expect(saveSettings(defaults)).toBe(false);
  expect(saveSettings(null)).toBe(false);
});

test('legacy discovery RPC settings are ignored without discarding gateways or private RPCs', () => {
  values.set(SETTINGS_KEY, JSON.stringify({ ...defaults, bootstrapRpc: 'https://old-direct-rpc.example/private-key' }));
  expect(loadSettings(defaults)).toEqual(defaults);
  expect(saveSettings(loadSettings(defaults))).toBe(true);
  expect(values.get(SETTINGS_KEY)).not.toContain('bootstrapRpc');
  expect(values.get(SETTINGS_KEY)).not.toContain('old-direct-rpc');
});

test('custom checkpoints persist, normalize and reset without changing legacy defaults', () => {
  const checkpoint = { root: '0x' + 'AB'.repeat(32), slot: 15589024 };
  const settings = validateSettings({ ...defaults, checkpoint });
  expect(settings.checkpoint).toEqual({ root: checkpoint.root.toLowerCase(), slot: checkpoint.slot });
  expect(saveSettings(settings)).toBe(true);
  expect(loadSettings(defaults).checkpoint).toEqual(settings.checkpoint);
  expect(saveSettings(null)).toBe(true);
  expect(loadSettings(defaults).checkpoint).toBeUndefined();
  for (const bad of [null, {}, { root: '0x1234', slot: 1 }, { root: '0x' + '0'.repeat(64), slot: 1 },
    ...[0, -1, 1.1, '15589024', Number.MAX_SAFE_INTEGER].map(slot => ({ ...checkpoint, slot }))]) {
    expect(() => validateSettings({ ...defaults, checkpoint: bad })).toThrow('Checkpoint');
  }
});
