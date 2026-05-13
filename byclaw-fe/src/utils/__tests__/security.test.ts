import { InputValidator, OutputEncoder, SecurityUtils } from '../security';

// Mock DOMPurify
jest.mock('dompurify', () => ({
  sanitize: jest.fn((input) => input),
}));

// Mock constants
jest.mock(
  '../constants/app',
  () => ({
    REGEX_PATTERNS: {
      EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      PHONE: /^1[3-9]\d{9}$/,
      URL: /^https?:\/\/.+/,
    },
  }),
  { virtual: true }
);

describe('Security Utils', () => {
  describe('InputValidator', () => {
    describe('validateEmail', () => {
      it('should validate correct email format', () => {
        const result = InputValidator.validateEmail('test@example.com');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should reject empty email', () => {
        const result = InputValidator.validateEmail('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('邮箱不能为空');
      });

      it('should reject null email', () => {
        const result = InputValidator.validateEmail(null as any);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('邮箱不能为空');
      });

      it('should reject invalid email format', () => {
        const result = InputValidator.validateEmail('invalid-email');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('邮箱格式不正确');
      });

      it('should reject email that is too long', () => {
        const longEmail = 'a'.repeat(250) + '@example.com';
        const result = InputValidator.validateEmail(longEmail);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('邮箱长度不能超过254个字符');
      });
    });

    describe('validatePhone', () => {
      it('should validate correct phone number', () => {
        const result = InputValidator.validatePhone('13812345678');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should reject empty phone', () => {
        const result = InputValidator.validatePhone('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('手机号不能为空');
      });

      it('should reject invalid phone format', () => {
        const result = InputValidator.validatePhone('1234567890');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('手机号格式不正确');
      });

      it('should reject phone starting with invalid number', () => {
        const result = InputValidator.validatePhone('12812345678');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('手机号格式不正确');
      });
    });

    describe('validatePassword', () => {
      it('should validate strong password', () => {
        const result = InputValidator.validatePassword('StrongPass123!');
        expect(result.valid).toBe(true);
        expect(result.strength).toBe('strong');
        expect(result.error).toBeUndefined();
      });

      it('should validate medium password', () => {
        const result = InputValidator.validatePassword('Medium123');
        expect(result.valid).toBe(true);
        expect(result.strength).toBe('medium');
        expect(result.error).toBeUndefined();
      });

      it('should reject empty password', () => {
        const result = InputValidator.validatePassword('');
        expect(result.valid).toBe(false);
        expect(result.strength).toBe('weak');
        expect(result.error).toBe('密码不能为空');
      });

      it('should reject short password', () => {
        const result = InputValidator.validatePassword('1234567');
        expect(result.valid).toBe(false);
        expect(result.strength).toBe('weak');
        expect(result.error).toBe('密码长度不能少于8个字符');
      });

      it('should reject long password', () => {
        const longPassword = 'a'.repeat(130);
        const result = InputValidator.validatePassword(longPassword);
        expect(result.valid).toBe(false);
        expect(result.strength).toBe('weak');
        expect(result.error).toBe('密码长度不能超过128个字符');
      });

      it('should reject weak password', () => {
        const result = InputValidator.validatePassword('password');
        expect(result.valid).toBe(false);
        expect(result.strength).toBe('weak');
        expect(result.error).toBe('密码强度太弱，请包含大小写字母、数字和特殊字符');
      });
    });

    describe('validateUsername', () => {
      it('should validate correct username', () => {
        const result = InputValidator.validateUsername('testuser123');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should validate username with Chinese characters', () => {
        const result = InputValidator.validateUsername('测试用户');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should validate username with underscores and hyphens', () => {
        const result = InputValidator.validateUsername('test_user-name');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should reject empty username', () => {
        const result = InputValidator.validateUsername('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('用户名不能为空');
      });

      it('should reject short username', () => {
        const result = InputValidator.validateUsername('a');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('用户名长度不能少于2个字符');
      });

      it('should reject long username', () => {
        const longUsername = 'a'.repeat(21);
        const result = InputValidator.validateUsername(longUsername);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('用户名长度不能超过20个字符');
      });

      it('should reject username with special characters', () => {
        const result = InputValidator.validateUsername('test@user');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('用户名只能包含字母、数字、中文、下划线和连字符');
      });
    });

    describe('validateUrl', () => {
      it('should validate correct URL', () => {
        const result = InputValidator.validateUrl('https://example.com');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should validate HTTP URL', () => {
        const result = InputValidator.validateUrl('http://example.com');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should reject empty URL', () => {
        const result = InputValidator.validateUrl('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('URL不能为空');
      });

      it('should reject invalid URL format', () => {
        const result = InputValidator.validateUrl('not-a-url');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('URL格式不正确');
      });

      it('should reject URL without protocol', () => {
        const result = InputValidator.validateUrl('example.com');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('URL格式不正确');
      });
    });

    describe('detectSqlInjection', () => {
      it('should detect SELECT injection', () => {
        const result = InputValidator.detectSqlInjection('SELECT * FROM users');
        expect(result.detected).toBe(true);
        expect(result.patterns.length).toBeGreaterThan(0);
      });

      it('should detect UNION injection', () => {
        const result = InputValidator.detectSqlInjection("' UNION SELECT * FROM users --");
        expect(result.detected).toBe(true);
        expect(result.patterns.length).toBeGreaterThan(0);
      });

      it('should detect DROP injection', () => {
        const result = InputValidator.detectSqlInjection("'; DROP TABLE users; --");
        expect(result.detected).toBe(true);
        expect(result.patterns.length).toBeGreaterThan(0);
      });

      it('should not detect normal input', () => {
        const result = InputValidator.detectSqlInjection('normal user input');
        expect(result.detected).toBe(false);
        expect(result.patterns).toEqual([]);
      });

      it('should handle empty input', () => {
        const result = InputValidator.detectSqlInjection('');
        expect(result.detected).toBe(false);
        expect(result.patterns).toEqual([]);
      });

      it('should handle null input', () => {
        const result = InputValidator.detectSqlInjection(null as any);
        expect(result.detected).toBe(false);
        expect(result.patterns).toEqual([]);
      });
    });

    describe('detectXss', () => {
      it('should detect script tag', () => {
        const result = InputValidator.detectXss("<script>alert('xss')</script>");
        expect(result.detected).toBe(true);
        expect(result.patterns.length).toBeGreaterThan(0);
      });

      it('should detect javascript protocol', () => {
        const result = InputValidator.detectXss("<a href='javascript:alert(1)'>click</a>");
        expect(result.detected).toBe(true);
        expect(result.patterns.length).toBeGreaterThan(0);
      });

      it('should detect onload event', () => {
        const result = InputValidator.detectXss("<img onload='alert(1)'>");
        expect(result.detected).toBe(true);
        expect(result.patterns.length).toBeGreaterThan(0);
      });

      it('should not detect normal HTML', () => {
        const result = InputValidator.detectXss('<p>Normal paragraph</p>');
        expect(result.detected).toBe(false);
        expect(result.patterns).toEqual([]);
      });

      it('should handle empty input', () => {
        const result = InputValidator.detectXss('');
        expect(result.detected).toBe(false);
        expect(result.patterns).toEqual([]);
      });
    });
  });

  describe('OutputEncoder', () => {
    describe('htmlEncode', () => {
      it('should encode HTML entities', () => {
        const result = OutputEncoder.htmlEncode('<script>alert("xss")</script>');
        expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
      });

      it('should handle empty input', () => {
        const result = OutputEncoder.htmlEncode('');
        expect(result).toBe('');
      });

      it('should handle null input', () => {
        const result = OutputEncoder.htmlEncode(null as any);
        expect(result).toBe('');
      });
    });

    describe('htmlDecode', () => {
      it('should decode HTML entities', () => {
        const result = OutputEncoder.htmlDecode('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
        expect(result).toBe('<script>alert("xss")</script>');
      });

      it('should handle empty input', () => {
        const result = OutputEncoder.htmlDecode('');
        expect(result).toBe('');
      });
    });

    describe('urlEncode', () => {
      it('should encode URL components', () => {
        const result = OutputEncoder.urlEncode('hello world');
        expect(result).toBe('hello%20world');
      });

      it('should handle empty input', () => {
        const result = OutputEncoder.urlEncode('');
        expect(result).toBe('');
      });
    });

    describe('urlDecode', () => {
      it('should decode URL components', () => {
        const result = OutputEncoder.urlDecode('hello%20world');
        expect(result).toBe('hello world');
      });

      it('should handle invalid URL encoding', () => {
        const result = OutputEncoder.urlDecode('%invalid');
        expect(result).toBe('%invalid');
      });
    });

    describe('sanitizeHtml', () => {
      it('should sanitize HTML using DOMPurify', () => {
        const input = "<script>alert('xss')</script><p>Safe content</p>";
        const result = OutputEncoder.sanitizeHtml(input);
        expect(result).toBe(input); // Mocked DOMPurify returns input as-is
      });

      it('should handle empty input', () => {
        const result = OutputEncoder.sanitizeHtml('');
        expect(result).toBe('');
      });
    });
  });

  describe('SecurityUtils', () => {
    describe('generateSecureRandom', () => {
      it('should generate random string with default length', () => {
        const result = SecurityUtils.generateSecureRandom();
        expect(result).toHaveLength(32);
        expect(result).toMatch(/^[A-Za-z0-9]+$/);
      });

      it('should generate random string with custom length', () => {
        const result = SecurityUtils.generateSecureRandom(16);
        expect(result).toHaveLength(16);
        expect(result).toMatch(/^[A-Za-z0-9]+$/);
      });

      it('should generate different strings on successive calls', () => {
        const result1 = SecurityUtils.generateSecureRandom(10);
        const result2 = SecurityUtils.generateSecureRandom(10);
        expect(result1).not.toBe(result2);
      });
    });

    describe('generateCsrfToken', () => {
      it('should generate CSRF token', () => {
        const result = SecurityUtils.generateCsrfToken();
        expect(result).toHaveLength(32);
        expect(result).toMatch(/^[A-Za-z0-9]+$/);
      });
    });

    describe('validateCsrfToken', () => {
      it('should validate matching tokens', () => {
        const token = 'test-token';
        const result = SecurityUtils.validateCsrfToken(token, token);
        expect(result).toBe(true);
      });

      it('should reject non-matching tokens', () => {
        const result = SecurityUtils.validateCsrfToken('token1', 'token2');
        expect(result).toBe(false);
      });

      it('should reject empty tokens', () => {
        const result = SecurityUtils.validateCsrfToken('', 'token');
        expect(result).toBe(false);
      });

      it('should reject null tokens', () => {
        const result = SecurityUtils.validateCsrfToken(null as any, 'token');
        expect(result).toBe(false);
      });
    });

    describe('sanitizeFileName', () => {
      it('should sanitize file name with special characters', () => {
        const result = SecurityUtils.sanitizeFileName('file<>:"|?*.txt');
        expect(result).toBe('file_______.txt');
      });

      it('should handle empty file name', () => {
        const result = SecurityUtils.sanitizeFileName('');
        expect(result).toBe('file');
      });

      it('should handle null file name', () => {
        const result = SecurityUtils.sanitizeFileName(null as any);
        expect(result).toBe('file');
      });

      it('should remove multiple underscores', () => {
        const result = SecurityUtils.sanitizeFileName('file___name.txt');
        expect(result).toBe('file_name.txt');
      });
    });

    describe('isSafeContentType', () => {
      it('should identify safe content types', () => {
        expect(SecurityUtils.isSafeContentType('text/plain')).toBe(true);
        expect(SecurityUtils.isSafeContentType('image/jpeg')).toBe(true);
        expect(SecurityUtils.isSafeContentType('application/json')).toBe(true);
      });

      it('should identify unsafe content types', () => {
        expect(SecurityUtils.isSafeContentType('application/octet-stream')).toBe(false);
        expect(SecurityUtils.isSafeContentType('text/x-executable')).toBe(false);
      });

      it('should be case insensitive', () => {
        expect(SecurityUtils.isSafeContentType('TEXT/PLAIN')).toBe(true);
        expect(SecurityUtils.isSafeContentType('IMAGE/JPEG')).toBe(true);
      });
    });

    describe('validateCSP', () => {
      it('should validate clean HTML', () => {
        const result = SecurityUtils.validateCSP('<p>Clean content</p>');
        expect(result.valid).toBe(true);
        expect(result.violations).toEqual([]);
      });

      it('should detect inline scripts', () => {
        const result = SecurityUtils.validateCSP('<script>alert("xss")</script>');
        expect(result.valid).toBe(false);
        expect(result.violations).toContain('内联脚本被检测到');
      });

      it('should detect inline styles', () => {
        const result = SecurityUtils.validateCSP('<style>body { color: red; }</style>');
        expect(result.valid).toBe(false);
        expect(result.violations).toContain('内联样式被检测到');
      });

      it('should detect event handlers', () => {
        const result = SecurityUtils.validateCSP('<div onclick="alert(1)">Click me</div>');
        expect(result.valid).toBe(false);
        expect(result.violations).toContain('事件处理器被检测到');
      });
    });
  });
});
