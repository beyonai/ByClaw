import { parse } from '@babel/parser';
import fs from 'fs';
import path from 'path';

it('keeps employee management valid TSX after moving the approval panel', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
  // 此页的既有源码契约测试不加载组件，单独解析 JSX 可捕获迁移时残留的闭合标签。
  expect(() => parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
});
