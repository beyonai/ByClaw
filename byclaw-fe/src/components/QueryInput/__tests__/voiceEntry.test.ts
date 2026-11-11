import fs from 'fs';
import path from 'path';

const voiceEntry = /\{\s*this\.STTRender\(\)\s*\}/;

it('renders the voice entry in the chat input', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../queryInputBase.tsx'), 'utf8');

  expect(source).toMatch(voiceEntry);
});

it('keeps the voice entry hidden in the search input', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../pages/searchAndQuery/components/ChatLayoutComp/components/QueryInput/QueryInputComp.tsx'
    ),
    'utf8'
  );

  expect(source).not.toMatch(voiceEntry);
});
