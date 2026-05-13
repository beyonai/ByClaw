import { generateSignature } from '../signature';

// Mock crypto-js
jest.mock('crypto-js', () => ({
  MD5: jest.fn((str: string) => ({
    toString: jest.fn(() => 'mock-md5-hash'),
  })),
  enc: {
    Hex: 'hex',
  },
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe.skip('signature utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue('test-user-code');
  });

  describe('generateSignature', () => {
    it('should generate signature for GET request', () => {
      const method = 'GET';
      const data = { name: 'test', age: 25 };

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
      expect(result['x-signature-value']).toBe('mock-md5-hash');
    });

    it('should generate signature for POST request with object data', () => {
      const method = 'POST';
      const data = { name: 'test', age: 25 };

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
    });

    it('should generate signature for POST request with string data', () => {
      const method = 'POST';
      const data = 'test string data';

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
    });

    it('should handle FormData for POST request', () => {
      const method = 'POST';
      const data = new FormData();
      data.append('file', 'test content');

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
    });

    it('should handle PUT request', () => {
      const method = 'PUT';
      const data = { id: 1, name: 'updated' };

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
    });

    it('should handle null data', () => {
      const method = 'POST';
      const data = null;

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
    });

    it('should use empty string when no user code in localStorage', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      const method = 'GET';
      const data = { name: 'test' };

      const result = generateSignature(method, data);

      expect(result).toHaveProperty('x-signature-nonce');
      expect(result).toHaveProperty('x-signature-timestamp');
      expect(result).toHaveProperty('x-signature-value');
    });

    it('should generate unique nonce for each call', () => {
      const method = 'GET';
      const data = { name: 'test' };

      const result1 = generateSignature(method, data);
      const result2 = generateSignature(method, data);

      expect(result1['x-signature-nonce']).not.toBe(result2['x-signature-nonce']);
    });

    it('should generate timestamp for each call', () => {
      const method = 'GET';
      const data = { name: 'test' };

      const result1 = generateSignature(method, data);
      const result2 = generateSignature(method, data);

      expect(result1['x-signature-timestamp']).toBeDefined();
      expect(result2['x-signature-timestamp']).toBeDefined();
      expect(typeof result1['x-signature-timestamp']).toBe('string');
      expect(typeof result2['x-signature-timestamp']).toBe('string');
    });
  });
});
