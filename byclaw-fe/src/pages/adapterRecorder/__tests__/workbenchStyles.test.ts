import fs from 'node:fs';
import path from 'node:path';

const recorderDir = path.resolve(__dirname, '..');

describe('adapter recorder scoped styles', () => {
  it('keeps Workbench styles in a CSS Module with scoped AntD overrides', () => {
    const pageSource = fs.readFileSync(path.join(recorderDir, 'index.tsx'), 'utf8');
    const modulePath = path.join(recorderDir, 'index.module.less');
    const moduleSource = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';

    expect(pageSource).toContain("import styles from './index.module.less';");
    expect(pageSource).not.toContain("import './global.less';");
    expect(fs.existsSync(path.join(recorderDir, 'global.less'))).toBe(false);

    expect(moduleSource).toContain(':global(.beyond-card)');
    expect(moduleSource).toContain(':global(.beyond-typography-secondary)');
    expect(moduleSource).toContain(':global(.beyond-input-affix-wrapper)');
    expect(moduleSource).toContain(':global(.beyond-segmented)');
    expect(moduleSource).toContain(':global(.beyond-segmented-item:hover .beyond-segmented-item-label)');
    expect(moduleSource).toContain(':global(.beyond-switch)');
    expect(moduleSource).toContain(':global(.beyond-alert-info)');
    expect(moduleSource).toContain(':global(.beyond-form-item-label > label)');
    expect(moduleSource).toContain(':global(.beyond-form-item-control-input-content)');
    expect(moduleSource).toContain(':global(.beyond-space-item)');
    expect(moduleSource).not.toContain('.wb-stage .beyond-card');
  });
});
