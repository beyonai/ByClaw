import { getSandboxDynamicUrl, setSandboxDynamicUrl } from '../sandboxDynamicUrl';

describe('utils/sandboxDynamicUrl', () => {
  it('stores and retrieves string urls by session id', () => {
    setSandboxDynamicUrl('s1', 'https://sandbox.example.com');
    expect(getSandboxDynamicUrl('s1')).toBe('https://sandbox.example.com');
  });

  it('stores and retrieves url resolver functions', () => {
    const resolver = (url: string, symbol: string) => `${url}/${symbol}`;
    setSandboxDynamicUrl('s2', resolver);
    expect(getSandboxDynamicUrl('s2')).toBe(resolver);
  });

  it('ignores empty session ids and returns undefined for missing entries', () => {
    setSandboxDynamicUrl('', 'https://ignored.example.com');
    expect(getSandboxDynamicUrl('')).toBeUndefined();
    expect(getSandboxDynamicUrl('missing')).toBeUndefined();
  });
});
