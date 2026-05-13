import type { Config } from 'jest';

const config: Config = {
  testEnvironment: '<rootDir>/jest.environment.js',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@beyond/(.*)$': '<rootDir>/src/$1',
    '^canvas$': '<rootDir>/src/__mocks__/canvasMock.js',
    '\\.(less|css|scss)$': 'identity-obj-proxy',
    '\\.(png|jpg|jpeg|gif|svg|webp|ico)$': '<rootDir>/src/__mocks__/fileMock.js',
  },
  transformIgnorePatterns: ['node_modules/(?!(@umijs|@ant-design|antd)/)'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.{ts,tsx,js,jsx}',
    '<rootDir>/src/**/*.test.{ts,tsx,js,jsx}',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/.umi/**',
    '!src/.umi-production/**',
  ],
  globals: {
    _PUBLIC_PATH_: '/',
    PREFIX_NAME: 'beyond',
    BI_CLOUD: '',
    THEME: '',
    BUILD_TIME: 0,
  },
};

export default config;
