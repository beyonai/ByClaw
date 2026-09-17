import assert from 'node:assert/strict';
import test from 'node:test';

const policy = await import('./url-authorization.mjs').catch(() => ({}));

test('normalizes equivalent URLs and allows safe same-site redirects', () => {
  assert.equal(typeof policy.authorizationAllowsHttpRedirect, 'function');
  assert.equal(
    policy.authorizationEquivalentHttpUrl('https://example.com/a/', 'https://EXAMPLE.com/a#part'),
    true,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect(
      'https://m.example.com/article/1',
      'https://www.example.com/article/1?source=redirect',
      [],
    ),
    true,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect('http://m.example.com/a', 'https://www.example.com/b', []),
    true,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect('https://m.example.com/a', 'http://www.example.com/b', []),
    false,
  );
});

test('fails closed for ports, IP hosts, private suffix tenants, and unrelated sites', () => {
  assert.equal(
    policy.authorizationAllowsHttpRedirect('https://example.com/a', 'https://example.com:8443/b', []),
    false,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect(
      'https://example.com/a',
      'https://example.com:8443/b',
      ['https://example.com:8443/b'],
    ),
    true,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect('http://127.0.0.1/a', 'http://127.0.0.1/b', []),
    false,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect('https://one.github.io/a', 'https://two.github.io/b', []),
    false,
  );
  assert.equal(
    policy.authorizationAllowsHttpRedirect('https://example.com/a', 'https://example.net/a', []),
    false,
  );
});

test('allows only the bounded Sogou-to-WeChat article transition', () => {
  assert.equal(policy.authorizationAllowsHttpRedirect(
    'https://weixin.sogou.com/link?url=opaque',
    'https://mp.weixin.qq.com/s/article-id?token=opaque',
  ), true);
  assert.equal(policy.authorizationAllowsHttpRedirect(
    'https://weixin.sogou.com/search?query=article',
    'https://mp.weixin.qq.com/s/article-id',
  ), false);
  assert.equal(policy.authorizationAllowsHttpRedirect(
    'https://weixin.sogou.com/link?url=opaque',
    'https://mp.weixin.qq.com/profile?user=publisher',
  ), false);
  assert.equal(policy.authorizationAllowsHttpRedirect(
    'https://example.com/link',
    'https://mp.weixin.qq.com/s/article-id',
  ), false);
  assert.equal(policy.authorizationAllowsHttpRedirect(
    'https://weixin.sogou.com:444/link?url=opaque',
    'https://mp.weixin.qq.com/s/article-id',
  ), false);
});

test('redacts credentials and sensitive query values in display URLs', () => {
  const displayed = policy.diagnosticHttpUrl(
    'https://user:pass@example.com/a?token=secret&signature=abc&safe=value#fragment',
  );
  assert.equal(displayed.includes('user'), false);
  assert.equal(displayed.includes('pass'), false);
  assert.equal(displayed.includes('secret'), false);
  assert.equal(displayed.includes('abc'), false);
  assert.match(displayed, /token=%5BREDACTED%5D/);
  assert.match(displayed, /safe=value/);
  assert.equal(displayed.includes('#fragment'), false);

  const malformed = policy.diagnosticHttpUrl('not-a-url?token=super-secret&safe=value');
  assert.equal(malformed.includes('super-secret'), false);
  assert.match(malformed, /token=\[REDACTED\]/);
  assert.match(malformed, /safe=value/);
});

test('redacts sensitive assignments at the start and across malformed bearer or quoted values', () => {
  for (const malformed of [
    'token=super-secret safe=value',
    'failure authorization=Bearer super-secret; safe=value',
    'failure password="super secret"&safe=value',
  ]) {
    const displayed = policy.diagnosticHttpUrl(malformed);
    assert.equal(displayed.includes('super-secret'), false, displayed);
    assert.equal(displayed.includes('super secret'), false, displayed);
    assert.match(displayed, /REDACTED/);
    assert.match(displayed, /safe=value/);
  }
});
