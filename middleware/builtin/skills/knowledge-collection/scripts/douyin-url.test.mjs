import assert from 'node:assert/strict';
import test from 'node:test';
import * as douyin from './douyin-artifacts.mjs';

test('accepts a jingxuan modal source while preserving its authorized URL and query', () => {
  assert.equal(douyin.sourceUrl('https://www.douyin.com/jingxuan?recommend=1&modal_id=18446744073709551615#player'),
    'https://www.douyin.com/jingxuan?recommend=1&modal_id=18446744073709551615');
  assert.equal(douyin.sourceUrl('https://douyin.com/jingxuan/?modal_id=123'),
    'https://douyin.com/jingxuan/?modal_id=123');
  assert.equal(douyin.sourceUrl('https://www.douyin.com/?modal_id=123'),
    'https://www.douyin.com/?modal_id=123');
  assert.equal(douyin.sourceUrl('https://douyin.com/?modal_id=123456789012345678901234567890'),
    'https://douyin.com/?modal_id=123456789012345678901234567890');
});

test('keeps existing short, video and note sources available', () => {
  assert.equal(douyin.sourceUrl('https://v.douyin.com/RpopXC5PB9c/'), 'https://v.douyin.com/RpopXC5PB9c/');
  assert.equal(douyin.sourceUrl('https://www.douyin.com/video/123?modal_id=123'),
    'https://www.douyin.com/video/123?modal_id=123');
  assert.equal(douyin.sourceUrl('https://douyin.com/note/123/'), 'https://douyin.com/note/123/');
});

test('rejects duplicated or malformed modal IDs even on existing video and short sources', () => {
  for (const query of ['modal_id=', 'modal_id=abc', 'modal_id=-123', 'modal_id=123.0',
    'modal_id=1e3', 'modal_id=+123', 'modal_id=1234567890123456789012345678901',
    'modal_id=123&modal_id=123', 'modal_id=123&%6dodal_id=456']) {
    for (const base of ['https://www.douyin.com/jingxuan', 'https://www.douyin.com/video/123',
      'https://v.douyin.com/RpopXC5PB9c/']) {
      assert.throws(() => douyin.sourceUrl(`${base}?${query}`), /DOUYIN_SOURCE_INVALID/, `${base}?${query}`);
    }
  }
});

test('rejects conflicting path and modal IDs so adapters cannot select a different work', () => {
  for (const pathname of ['/video/123', '/note/123/']) {
    assert.throws(() => douyin.sourceUrl(`https://www.douyin.com${pathname}?modal_id=456`), /DOUYIN_SOURCE_INVALID/);
  }
});

test('modal support preserves host, protocol, credential, sensitive-query and path boundaries', () => {
  for (const input of [
    'http://www.douyin.com/jingxuan?modal_id=123',
    'https://www.douyin.com.evil.test/jingxuan?modal_id=123',
    'https://other.douyin.com/jingxuan?modal_id=123',
    'https://user:pass@www.douyin.com/jingxuan?modal_id=123',
    'https://www.douyin.com:8080/jingxuan?modal_id=123',
    'https://www.douyin.com/jingxuan?modal_id=123&access_token=secret',
    'https://www.douyin.com/jingxuan?modal_id=123&Cookie=secret',
    'https://www.douyin.com/jingxuan?modal_id=123&session=secret',
    'https://www.douyin.com/jingxuan?modal_id=123&auth=secret',
    'https://www.douyin.com/jingxuan?modal_id=123&secret=secret',
    'https://www.douyin.com/jingxuan?modal_id=123&password=secret',
    'https://www.douyin.com/jingxuan',
    'https://www.douyin.com/',
    'https://www.douyin.com/search/query?modal_id=123',
    'https://www.douyin.com/user/example?modal_id=123',
    'https://www.douyin.com/unknown?modal_id=123',
    'https://www.douyin.com/jingxuan/extra?modal_id=123',
  ]) assert.throws(() => douyin.sourceUrl(input), /DOUYIN_SOURCE_INVALID/, input);
});

test('extracts an explicit source work ID without rounding long IDs or inventing one for short links', () => {
  assert.equal(typeof douyin.sourceWorkId, 'function');
  assert.equal(douyin.sourceWorkId('https://www.douyin.com/jingxuan?modal_id=18446744073709551615'), '18446744073709551615');
  assert.equal(douyin.sourceWorkId('https://douyin.com/?modal_id=123'), '123');
  assert.equal(douyin.sourceWorkId('https://www.douyin.com/video/123?modal_id=123'), '123');
  assert.equal(douyin.sourceWorkId('https://douyin.com/note/456/'), '456');
  assert.equal(douyin.sourceWorkId('https://v.douyin.com/RpopXC5PB9c/'), undefined);
  assert.throws(() => douyin.sourceWorkId('https://www.douyin.com/video/123?modal_id=456'), /DOUYIN_SOURCE_INVALID/);
  assert.throws(() => douyin.sourceWorkId('https://example.com/jingxuan?modal_id=123'), /DOUYIN_SOURCE_INVALID/);
});
