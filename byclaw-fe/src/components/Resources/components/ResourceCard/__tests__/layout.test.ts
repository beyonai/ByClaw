import fs from 'fs';
import path from 'path';

it('uses equal primary button dimensions and compensates the install glyph whitespace', () => {
  // JSDOM 不计算 Less 和 SVG 实际尺寸；保护尺寸约定，视觉大小仍需浏览器确认。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const primary = styles.match(/\.cardPrimaryActionBtn\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  const icon = primary.match(/\.cardActionBtnIcon\s*\{([^}]+)/)?.[1] || '';
  const installIcon = primary.match(/\.installActionIcon\s*\{([^}]+)/)?.[1] || '';

  expect(primary).toContain('width: 32px;');
  expect(primary).toContain('min-width: 32px;');
  expect(primary).toContain('height: 32px;');
  expect(primary).toContain('padding: 0;');
  expect(primary).toContain('flex-shrink: 0;');
  expect(icon).toContain('font-size: 16px;');
  expect(installIcon).toContain('font-size: 18px;');
});

it('shows a forbidden cursor on disabled cards without blocking action buttons', () => {
  // JSDOM 不计算 Less 光标样式，保护已有禁用样式，点击边界由组件用例覆盖。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const disabled = styles.match(/\.disabledClickCard,\s*\.disabledClickContent\s*\{([^}]+)/)?.[1] || '';

  expect(disabled).toContain('cursor: not-allowed;');
  expect(disabled).not.toContain('pointer-events: none;');
});

it('anchors knowledge tags to the card corner and reserves space with or without actions', () => {
  // JSDOM 不计算定位和遮挡，静态保护标签边界及标题留白；视觉效果需浏览器确认。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const content = styles.match(/\.renderContent\s*\{([^}]+)/)?.[1] || '';
  const tag = styles.match(/\.renderContent\s+\.knowledgeTopRightTag\s*\{([^}]+)/)?.[1] || '';
  const header = styles.match(/\.knowledgeHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const headerWithActions = styles.match(/\.resourceInfoWithActions\s+\.knowledgeHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const actionSpace = styles.match(/\.resourceInfoWithActions\s*\{([^}]+)/)?.[1] || '';

  expect(content).toContain('position: relative;');
  expect(tag).toContain('position: absolute;');
  expect(tag).toContain('top: 12px;');
  expect(tag).toContain('right: 12px;');
  expect(tag).toContain('max-width: 88px;');
  expect(header).toContain('padding-right: 100px;');
  expect(headerWithActions).toContain('padding-right: 52px;');
  expect(actionSpace).toContain('padding-right: 48px;');
});

it('reserves only the measured skill corner tag width above the lowered actions', () => {
  // JSDOM 不计算 Less 布局：静态保护角标定位和操作区间距，实际视觉效果需浏览器确认。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const tag = styles.match(/\.skillPosterTag\s*\{([^}]+)/)?.[1] || '';
  const actions = styles.match(/\.skillPosterActions\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  const header = styles.match(/\.skillPosterHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const headerWithActions =
    styles.match(/\.resourceInfoWithActions\s+\.skillPosterHeaderWithTag\s*\{([^}]+)/)?.[1] || '';

  expect(tag).toContain('position: absolute;');
  expect(tag).toContain('top: 12px;');
  expect(tag).toContain('right: 12px;');
  expect(tag).toContain('max-width: 88px;');
  expect(actions).toContain('top: 40px;');
  expect(actions).toContain('bottom: auto;');
  expect(actions).toContain('transform: none;');
  expect(actions).toContain('height: 24px;');
  expect(header).toContain('padding-right: calc(var(--skill-poster-tag-width, 88px) + 12px + 8px - 22px);');
  expect(headerWithActions).toContain('margin-right: -48px;');
  expect(header).not.toContain('padding-right: 100px;');
  expect(headerWithActions).not.toContain('padding-right: 52px;');
});

it('keeps knowledge actions below the tag without anchoring them to the card bottom', () => {
  // 保留共用按钮样式，但知识按钮按顶部定位，收藏行与申请状态不应改变其位置。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const actions = styles.match(/\.knowledgeActions\s*\{([^}]+)/)?.[1] || '';

  expect(actions).toContain('.skillPosterActions();');
  expect(actions).toContain('top: 40px;');
  expect(actions).toContain('bottom: auto;');
});

it('compacts knowledge cards while reserving space for two description lines and favorites', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const card = styles.match(/\.resourceCard\.knowledgeCard\s*\{([^}]+)/)?.[1] || '';

  expect(card).toContain('height: 128px;');
  expect(card).toContain('&.favoriteCard');
  expect(card).toContain('height: 164px;');
});

it('compacts digital employee cards with symmetric padding and space for favorites', () => {
  // JSDOM 不计算 Less 布局，保护员工专属高度与上下内边距，实际留白需浏览器确认。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const card = styles.match(/\.resourceCard\.digitalEmployeeCard\s*\{([^}]+)/)?.[1] || '';
  const content = styles.match(/\.renderContent\s*\{([^}]+)/)?.[1] || '';

  expect(card).toContain('height: 134px;');
  expect(card).toContain('&.favoriteCard');
  expect(card).toContain('height: 170px;');
  expect(content).toContain('padding: 12px;');
});

it('lets employee tags occupy title space and truncates the title itself', () => {
  // JSDOM 不计算实际溢出，保护标签参与布局、名称可收缩和 CSS 单行省略规则。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const tag = styles.match(/\.digitalEmployeeTopRightTag\s*\{([^}]+)/)?.[1] || '';
  const header = styles.match(/\.resourceInfoHeader\.resourceInfoHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const title = styles.match(/\.resourceInfoHeaderWithTag\s+\.resourceName\s*\{([^}]+)/)?.[1] || '';
  const headerWithActions =
    styles.match(/\.resourceInfoWithActions\s+\.resourceInfoHeaderWithTag\s*\{([^}]+)/)?.[1] || '';

  expect(tag).toContain('position: static;');
  expect(tag).toContain('flex-shrink: 0;');
  expect(header).toContain('gap: 8px;');
  expect(title).toContain('flex: 1 1 0%;');
  expect(title).toContain('overflow: hidden;');
  expect(title).toContain('text-overflow: ellipsis;');
  expect(title).toContain('white-space: nowrap;');
  expect(headerWithActions).toContain('margin-right: -48px;');
});

it('keeps pending icon slots fixed and uses the same employee and knowledge alignment', () => {
  // JSDOM 不计算尺寸：保护固定按钮槽位，交互用例覆盖悬浮提示和确认前后的状态切换。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const actions = styles.match(/\.digitalEmployeeActions\s*\{([^}]+)/)?.[1] || '';
  // 读取到顶层闭合括号，避免 Less 插值和嵌套选择器提前截断按钮事件样式。
  const slot = styles.match(/\.applyActionWrap\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  const employeeActions = styles.match(/\.digitalEmployeeCard\s+\.digitalEmployeeActions\s*\{([^}]+)/)?.[1] || '';

  expect(actions).toContain('width: 32px;');
  expect(slot).toContain('width: 32px;');
  expect(slot).toContain('height: 32px;');
  expect(slot).toContain('cursor: not-allowed;');
  expect(slot).toContain('pointer-events: none;');
  expect(employeeActions).toContain('.knowledgeActions();');
});

it('keeps skill posters compact without reserving a pending caption line', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const card = styles.match(/\.skillPosterCard\s*\{([^}]+)/)?.[1] || '';
  const favoriteCard = styles.match(/\.skillPosterFavoriteCard\s*\{([^}]+)/)?.[1] || '';
  const actions = styles.match(/\.skillPosterActions\s*\{([\s\S]*?)^\}/m)?.[1] || '';

  // 待审核仅用悬浮提示，纵向按钮放在标签下方，不额外增加卡片高度。
  expect(card).toContain('height: 112px;');
  expect(favoriteCard).toContain('height: 148px;');
  expect(actions).toContain('top: 40px;');
  expect(actions).toContain('bottom: auto;');
});

it('aligns resource primary actions independently of the overflow menu', () => {
  // JSDOM 不计算按钮坐标，保护共用纵向布局；组件用例验证各模块及状态共用这一操作区。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const actions = styles.match(/\.resourceCardActions\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  const content = styles.match(/\.resourceInfoWithActions\s*\{([^}]+)/)?.[1] || '';

  expect(actions).toContain('top: 40px;');
  expect(actions).toContain('bottom: auto;');
  expect(actions).toContain('width: 32px;');
  expect(actions).toContain('height: auto;');
  expect(actions).toContain('flex-direction: column;');
  expect(actions).toContain('transform: none;');
  expect(actions).toContain('gap: 4px;');
  expect(actions).toContain('width: 24px;');
  expect(actions).toContain('height: 24px;');
  expect(content).toContain('padding-right: 48px;');
  expect(styles).not.toContain('.resourceInfoWithMoreActions');
});

it('anchors tool tags above vertical actions and reserves space for long titles', () => {
  // JSDOM 不计算 Less 布局，静态保护工具专属的角标、纵向按钮及标题留白。
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const tag = styles.match(/\.renderContent\s+\.toolTopRightTag\s*\{([^}]+)/)?.[1] || '';
  const actions = styles.match(/\.resourceCardActions\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  const header = styles.match(/\.toolHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const headerWithActions = styles.match(/\.resourceInfoWithActions\s+\.toolHeaderWithTag\s*\{([^}]+)/)?.[1] || '';

  expect(tag).toContain('position: absolute;');
  expect(tag).toContain('top: 12px;');
  expect(tag).toContain('right: 12px;');
  expect(tag).toContain('max-width: 88px;');
  expect(actions).toContain('top: 40px;');
  expect(actions).toContain('bottom: auto;');
  expect(actions).toContain('width: 32px;');
  expect(actions).toContain('height: auto;');
  expect(actions).toContain('flex-direction: column;');
  expect(actions).toContain('transform: none;');
  expect(header).toContain('padding-right: 100px;');
  expect(headerWithActions).toContain('padding-right: 52px;');
});

it('anchors default skill tags with the same title space as knowledge and tools', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const tag = styles.match(/\.renderContent\s+\.skillTopRightTag\s*\{([^}]+)/)?.[1] || '';
  const header = styles.match(/\.skillHeaderWithTag\s*\{([^}]+)/)?.[1] || '';
  const headerWithActions = styles.match(/\.resourceInfoWithActions\s+\.skillHeaderWithTag\s*\{([^}]+)/)?.[1] || '';

  expect(tag).toContain('position: absolute;');
  expect(tag).toContain('top: 12px;');
  expect(tag).toContain('right: 12px;');
  expect(tag).toContain('max-width: 88px;');
  expect(header).toContain('padding-right: 100px;');
  expect(headerWithActions).toContain('padding-right: 52px;');
});
