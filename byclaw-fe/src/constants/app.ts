/**
 * 应用常量定义
 */

// API相关常量
export const API_CONFIG = {
  TIMEOUT: 30000, // 30秒
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000, // 1秒
} as const;

// 文件上传相关常量
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  MAX_FILES: 10,
} as const;

// 分页相关常量
export const PAGINATION_CONFIG = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 1000,
} as const;

// 消息相关常量
export const MESSAGE_CONFIG = {
  MAX_LENGTH: 4000,
  TYPING_DELAY: 1000, // 1秒
  AUTO_SCROLL_DELAY: 100, // 100ms
} as const;

// 缓存相关常量
export const CACHE_CONFIG = {
  USER_INFO_TTL: 30 * 60 * 1000, // 30分钟
  API_CACHE_TTL: 5 * 60 * 1000, // 5分钟
  LOCAL_STORAGE_PREFIX: 'whale_bi_',
} as const;

// 主题相关常量
export const THEME_CONFIG = {
  DEFAULT_THEME: 'light',
  THEMES: ['light', 'dark'] as const,
  STORAGE_KEY: 'theme',
} as const;

// 路由相关常量
export const ROUTE_CONFIG = {
  LOGIN: '/login',
  HOME: '/',
  CHAT: '/chat',
  KNOWLEDGE: '/knowledge',
  SETTINGS: '/settings',
} as const;

// 权限相关常量
export const PERMISSION_CONFIG = {
  ROLES: {
    ADMIN: 'admin',
    USER: 'user',
    GUEST: 'guest',
  },
  ACTIONS: {
    READ: 'read',
    WRITE: 'write',
    DELETE: 'delete',
    MANAGE: 'manage',
  },
} as const;

// 错误码常量
export const ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;

// 状态常量
export const STATUS_CONFIG = {
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
  IDLE: 'idle',
} as const;

// 正则表达式常量
export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^1[3-9]\d{9}$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
  URL: /^https?:\/\/.+/,
} as const;

// 时间相关常量
export const TIME_CONFIG = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// 存储键名常量
export const STORAGE_KEYS = {
  USER_INFO: 'user_info',
  THEME: 'theme',
  LANGUAGE: 'language',
  SETTINGS: 'settings',
  TOKEN: 'token',
  REFRESH_TOKEN: 'refresh_token',
} as const;

// 事件名称常量
export const EVENT_NAMES = {
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  THEME_CHANGE: 'theme_change',
  LANGUAGE_CHANGE: 'language_change',
  MESSAGE_SEND: 'message_send',
  FILE_UPLOAD: 'file_upload',
} as const;
