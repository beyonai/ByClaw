jest.mock('@umijs/max', () => ({
  getDvaApp: jest.fn(),
}));

import { getDvaApp } from '@umijs/max';

import {
  fixU16Code,
  floatTo16BitPCM,
  getBgImgPosBySize,
  getDynamicParameters,
  getModelState,
  getPageQueryWithDecoder,
  getPublicPath,
  getRootPagePath,
  getRootUnAuthPagePath,
  getRuntimeActualUrl,
  isRootPage,
  num2time,
} from '../index';

const mockGetDvaApp = getDvaApp as jest.Mock;

describe('utils/index', () => {
  beforeEach(() => {
    mockGetDvaApp.mockReset();
    delete (window as Window & { publicPath?: string }).publicPath;
    window.history.replaceState({}, '', '/');
  });

  describe('getPublicPath', () => {
    it('uses the runtime publicPath when provided and normalizes slashes', () => {
      (window as Window & { publicPath?: string }).publicPath = 'assets';

      expect(getPublicPath()).toBe('/assets/');
    });

    it('falls back to the build time public path', () => {
      expect(getPublicPath()).toBe('/');
    });
  });

  describe('getRuntimeActualUrl', () => {
    it('returns absolute and data URLs unchanged', () => {
      expect(getRuntimeActualUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
      expect(getRuntimeActualUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    });

    it('prefixes relative URLs with the public path', () => {
      (window as Window & { publicPath?: string }).publicPath = '/static';

      expect(getRuntimeActualUrl('/img/logo.png')).toBe('/static/img/logo.png');
      expect(getRuntimeActualUrl('img/logo.png')).toBe('/static/img/logo.png');
    });

    it('returns falsy URLs as-is', () => {
      expect(getRuntimeActualUrl('')).toBe('');
    });
  });

  describe('getDynamicParameters', () => {
    it('extracts unique template parameters in order', () => {
      expect(getDynamicParameters('select * from {tenant_code} where id = {user_id} and id = {user_id}')).toEqual([
        '{tenant_code}',
        '{user_id}',
      ]);
    });

    it('returns an empty array when no parameters exist', () => {
      expect(getDynamicParameters('select * from table')).toEqual([]);
    });
  });

  describe('getBgImgPosBySize', () => {
    const size = { width: 20, height: 10, startY: 5 };

    it('calculates first-row positions', () => {
      expect(getBgImgPosBySize(0, size)).toBe('0 -5px');
      expect(getBgImgPosBySize(2, size)).toBe('-40px -5px');
    });

    it('calculates wrapped positions when rowCount is provided', () => {
      expect(getBgImgPosBySize(3, size, 3)).toBe('0 -5px');
      expect(getBgImgPosBySize(4, size, 3)).toBe('-20px -5px');
      expect(getBgImgPosBySize(7, size, 3)).toBe('-20px -15px');
    });
  });

  describe('getPageQueryWithDecoder', () => {
    it('parses a standard query string and keeps redirect decoded', () => {
      window.history.replaceState({}, '', '/login?name=alice%20bob&redirect=%2Fchat%3Fid%3D1');

      expect(getPageQueryWithDecoder()).toEqual({
        name: 'alice bob',
        redirect: '/chat?id=1',
      });
    });

    it('handles URLs containing multiple question marks', () => {
      window.history.replaceState({}, '', '/chat?first=1?second=2&third=3');

      expect(getPageQueryWithDecoder()).toEqual({
        first: '1?second=2',
        third: '3',
      });
    });

    it('returns an empty object when no query exists', () => {
      expect(getPageQueryWithDecoder()).toEqual({});
    });
  });

  describe('root path helpers', () => {
    it('identifies the root chat page', () => {
      window.history.replaceState({}, '', '/chat');
      expect(isRootPage()).toBe(true);

      window.history.replaceState({}, '', '/chat/');
      expect(isRootPage()).toBe(true);

      window.history.replaceState({}, '', '/chat/child');
      expect(isRootPage()).toBe(false);
    });

    it('returns the correct authenticated and unauthenticated root paths', () => {
      window.history.replaceState({}, '', '/mobile/workbench');
      expect(getRootPagePath()).toBe('/mobile');
      expect(getRootUnAuthPagePath()).toBe('/mobile/login');

      window.history.replaceState({}, '', '/chat/home');
      expect(getRootPagePath()).toBe('/chat');
      expect(getRootUnAuthPagePath()).toBe('/chat');
    });
  });

  describe('fixU16Code', () => {
    it('returns the original falsy value unchanged', () => {
      expect(fixU16Code('')).toBe('');
    });

    it('converts text using UTF-8 byte char codes', () => {
      expect(fixU16Code('A')).toBe('A');
      expect(fixU16Code('中')).toBe(String.fromCharCode(...new TextEncoder().encode('中')));
    });
  });

  describe('num2time', () => {
    it('formats seconds into mm:ss or h:mm:ss', () => {
      expect(num2time(0)).toBe('00:00');
      expect(num2time(59)).toBe('00:59');
      expect(num2time(61)).toBe('01:01');
      expect(num2time(3661)).toBe('1:01:01');
    });
  });

  describe('floatTo16BitPCM', () => {
    it('converts float samples to 16-bit PCM data', () => {
      const buffer = floatTo16BitPCM(new Float32Array([-1, -0.5, 0, 0.5, 1]));
      const view = new DataView(buffer);

      expect(Array.from({ length: 5 }, (_, index) => view.getInt16(index * 2, true))).toEqual([
        -32768, -16384, 0, 16383, 32767,
      ]);
    });
  });

  describe('getModelState', () => {
    it('returns a deep clone of the requested model state', () => {
      const originalState = {
        user: {
          profile: {
            name: 'Alice',
          },
        },
      };

      mockGetDvaApp.mockReturnValue({
        _store: {
          getState: () => originalState,
        },
      });

      const result = getModelState<typeof originalState.user>('user');

      expect(result).toEqual(originalState.user);
      expect(result).not.toBe(originalState.user);

      result.profile.name = 'Bob';
      expect(originalState.user.profile.name).toBe('Alice');
    });
  });
});
