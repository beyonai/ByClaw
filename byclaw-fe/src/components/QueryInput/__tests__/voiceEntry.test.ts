import fs from 'fs';
import path from 'path';

it.each([
  '../queryInputBase.tsx',
  '../../../pages/searchAndQuery/components/ChatLayoutComp/components/QueryInput/QueryInputComp.tsx',
])('keeps the voice entry commented out in %s', (relativePath) => {
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

  expect(source).not.toMatch(/\{\s*this\.STTRender\(\)\s*\}/);
});
