import fs from 'fs';
import path from 'path';

describe('employee conversation multiline text', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, './index.module.less'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, './index.tsx'), 'utf8');

  it.each(['agentDescription', 'prologueText'])('preserves line breaks and wraps long text in %s', (className) => {
    const rule = styles.match(new RegExp(`\\.${className}\\s*\\{([^{}]*)\\}`))?.[1];

    // Jest 将 Less 替换为类名代理，因此直接检查实际渲染节点绑定的样式约束。
    expect(page).toContain(`className={styles.${className}}`);
    expect(rule).toMatch(/white-space:\s*pre-wrap\s*;/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere\s*;/);
  });
});
