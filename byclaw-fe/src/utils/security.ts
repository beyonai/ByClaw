import DOMPurify from 'dompurify';
import { REGEX_PATTERNS } from '@/constants/app';

type ValidationResult = {
  valid: boolean;
  error?: string;
};

type PasswordValidationResult = ValidationResult & {
  strength: 'weak' | 'medium' | 'strong';
};

type DetectResult = {
  detected: boolean;
  patterns: string[];
};

const sqlPatterns: Array<[string, RegExp]> = [
  ['SELECT', /\bselect\b/i],
  ['UNION', /\bunion\b/i],
  ['DROP', /\bdrop\b/i],
  ['DELETE', /\bdelete\b/i],
  ['INSERT', /\binsert\b/i],
  ['UPDATE', /\bupdate\b/i],
  ['COMMENT', /--|\/\*/],
];

const xssPatterns: Array<[string, RegExp]> = [
  ['script', /<script[\s>]/i],
  ['javascript', /javascript:/i],
  ['event-handler', /\bon\w+\s*=/i],
  ['iframe', /<iframe[\s>]/i],
];

const safeContentTypes = new Set([
  'text/plain',
  'text/html',
  'text/css',
  'application/json',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const getRandomValues = (length: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(length);
    cryptoApi.getRandomValues(values);
    return Array.from(values, (value) => chars[value % chars.length]).join('');
  }

  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const InputValidator = {
  validateEmail(email?: string | null): ValidationResult {
    if (!email) {
      return { valid: false, error: '邮箱不能为空' };
    }
    if (email.length > 254) {
      return { valid: false, error: '邮箱长度不能超过254个字符' };
    }
    if (!REGEX_PATTERNS.EMAIL.test(email)) {
      return { valid: false, error: '邮箱格式不正确' };
    }
    return { valid: true };
  },

  validatePhone(phone?: string | null): ValidationResult {
    if (!phone) {
      return { valid: false, error: '手机号不能为空' };
    }
    if (!REGEX_PATTERNS.PHONE.test(phone)) {
      return { valid: false, error: '手机号格式不正确' };
    }
    return { valid: true };
  },

  validatePassword(password?: string | null): PasswordValidationResult {
    if (!password) {
      return { valid: false, error: '密码不能为空', strength: 'weak' };
    }
    if (password.length < 8) {
      return { valid: false, error: '密码长度不能少于8个字符', strength: 'weak' };
    }
    if (password.length > 128) {
      return { valid: false, error: '密码长度不能超过128个字符', strength: 'weak' };
    }

    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    const score = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;

    if (score < 3) {
      return { valid: false, error: '密码强度太弱，请包含大小写字母、数字和特殊字符', strength: 'weak' };
    }

    if (score === 3) {
      return { valid: true, strength: 'medium' };
    }

    return { valid: true, strength: 'strong' };
  },

  validateUsername(username?: string | null): ValidationResult {
    if (!username) {
      return { valid: false, error: '用户名不能为空' };
    }
    if (username.length < 2) {
      return { valid: false, error: '用户名长度不能少于2个字符' };
    }
    if (username.length > 20) {
      return { valid: false, error: '用户名长度不能超过20个字符' };
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(username)) {
      return { valid: false, error: '用户名只能包含字母、数字、中文、下划线和连字符' };
    }
    return { valid: true };
  },

  validateUrl(url?: string | null): ValidationResult {
    if (!url) {
      return { valid: false, error: 'URL不能为空' };
    }
    if (!REGEX_PATTERNS.URL.test(url)) {
      return { valid: false, error: 'URL格式不正确' };
    }
    return { valid: true };
  },

  detectSqlInjection(input?: string | null): DetectResult {
    if (!input) {
      return { detected: false, patterns: [] };
    }
    const patterns = sqlPatterns.filter(([, pattern]) => pattern.test(input)).map(([name]) => name);
    return { detected: patterns.length > 0, patterns };
  },

  detectXss(input?: string | null): DetectResult {
    if (!input) {
      return { detected: false, patterns: [] };
    }
    const patterns = xssPatterns.filter(([, pattern]) => pattern.test(input)).map(([name]) => name);
    return { detected: patterns.length > 0, patterns };
  },
};

export const OutputEncoder = {
  htmlEncode(input?: string | null) {
    if (!input) return '';

    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\//g, '&#x2F;');
  },

  htmlDecode(input?: string | null) {
    if (!input) return '';

    return input
      .replace(/&#x2F;/g, '/')
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  },

  urlEncode(input?: string | null) {
    if (!input) return '';
    return encodeURIComponent(input);
  },

  urlDecode(input?: string | null) {
    if (!input) return '';
    try {
      return decodeURIComponent(input);
    } catch (error) {
      return input;
    }
  },

  sanitizeHtml(input?: string | null) {
    if (!input) return '';
    return DOMPurify.sanitize(input);
  },
};

export const SecurityUtils = {
  generateSecureRandom(length: number = 32) {
    return getRandomValues(length);
  },

  generateCsrfToken() {
    return getRandomValues(32);
  },

  validateCsrfToken(token?: string | null, expectedToken?: string | null) {
    if (!token || !expectedToken) return false;
    return token === expectedToken;
  },

  sanitizeFileName(fileName?: string | null) {
    if (!fileName) return 'file';
    return fileName.replace(/_+/g, '_').replace(/[<>:"|?*]/g, '_');
  },

  isSafeContentType(contentType?: string | null) {
    if (!contentType) return false;
    return safeContentTypes.has(contentType.toLowerCase());
  },

  validateCSP(html?: string | null) {
    const violations: string[] = [];
    const value = html || '';

    if (/<script[\s>]/i.test(value)) {
      violations.push('内联脚本被检测到');
    }
    if (/<style[\s>]/i.test(value)) {
      violations.push('内联样式被检测到');
    }
    if (/\bon\w+\s*=/i.test(value)) {
      violations.push('事件处理器被检测到');
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  },
};
