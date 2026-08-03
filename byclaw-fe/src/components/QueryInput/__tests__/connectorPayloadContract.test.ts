import fs from 'fs';
import path from 'path';

describe('connector chat payload contract', () => {
  it.each(['Chat/index.tsx', 'Employees/index.tsx'])(
    'does not send per-message connector ids from %s',
    (relativePath) => {
      const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

      expect(source).not.toMatch(/extParams:\s*\{[\s\S]*?connectors\s*:/);
      expect(source).not.toContain('connectors.map((connector) => connector.id)');
    }
  );
});
