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

  it.each(['Chat/index.tsx', 'Employees/index.tsx'])(
    'keeps the session model selection per session and omits relModelId when unset in %s',
    (relativePath) => {
      const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

      // 选择按 sessionId 记忆，避免把 A 会话的模型带到 B 会话。
      expect(source).toContain('selectedModelBySession');
      expect(source).toContain('onModelSelectChange');
      // 未选择时不发送 relModelId（服务端保留已有覆盖）；'-1' 仅在用户显式选「默认模型」时发送。
      expect(source).toContain('...(this.state.selectedModelId ? { relModelId: this.state.selectedModelId } : {})');
      expect(source).not.toContain('relModelId: this.state.selectedModelId || -1');
    }
  );
});
