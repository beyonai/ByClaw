import fs from 'node:fs';
import path from 'node:path';

const recorderDir = path.resolve(__dirname, '..');

describe('adapter recorder scoped styles', () => {
  it('keeps Workbench styles in a CSS Module with scoped AntD overrides', () => {
    const pageSource = fs.readFileSync(path.join(recorderDir, 'index.tsx'), 'utf8');
    const modulePath = path.join(recorderDir, 'index.module.less');
    const moduleSource = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
    const headingStyle = moduleSource.slice(moduleSource.indexOf('.heading {'), moduleSource.indexOf('.title {'));
    const bodyStyle = moduleSource.slice(moduleSource.indexOf('.body {'), moduleSource.indexOf('.sidebar {'));
    const identityModuleSource = fs.readFileSync(
      path.join(recorderDir, 'components', 'UserIdentityBar.module.less'),
      'utf8'
    );

    expect(pageSource).toContain("import styles from './index.module.less';");
    expect(pageSource).toContain("import { useSelector } from '@umijs/max';");
    expect(pageSource).toContain("import UserIdentityBar from './components/UserIdentityBar';");
    expect(pageSource).toContain('const userInfo = useSelector(({ user }) => user.userInfo);');
    expect(pageSource).toContain('<aside className={styles.sidebar}');
    expect(pageSource).toContain('<main className={styles.stage}');
    expect(pageSource).toContain('<UserIdentityBar userInfo={userInfo} />');
    expect(pageSource).not.toContain("import StatePanel from './components/StatePanel';");
    const headerSource = pageSource.slice(pageSource.indexOf('<header'), pageSource.indexOf('</header>'));
    expect(headerSource).not.toContain('StatePanel');
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

    expect(moduleSource).toContain('@canvas: #f6f8fc;');
    expect(moduleSource).toContain('@surface: #ffffff;');
    expect(moduleSource).toContain('padding: clamp(8px, 1vw, 12px) clamp(12px, 2vw, 28px);');
    expect(bodyStyle).toContain('gap: 18px;');
    expect(headingStyle).toContain('align-items: baseline;');
    expect(headingStyle).toContain('justify-content: space-between;');
    expect(headingStyle).toContain('width: 100%;');
    expect(headingStyle).toContain('gap: 10px;');
    expect(moduleSource).toContain('.sidebar {');
    expect(moduleSource).toContain('flex: 1 1 auto;');
    expect(moduleSource).toMatch(/\.sidebar,\r?\n\.stage/);
    expect(moduleSource).toContain('height: 100%;');
    expect(moduleSource).toContain('@media (max-width: 767px)');
    expect(moduleSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(moduleSource).toContain(':global(:focus-visible)');
    expect(identityModuleSource).toContain('margin-top: auto;');
    expect(identityModuleSource).toMatch(/\.identity \{[\s\S]*?padding-top: 8px;/);
    expect(identityModuleSource).toMatch(/\.trigger \{[\s\S]*?padding: 4px 8px;/);
    expect(identityModuleSource).toMatch(/\.avatar \{[\s\S]*?width: 28px;[\s\S]*?height: 28px;/);
    expect(identityModuleSource).toContain(':focus-visible');
  });
});
