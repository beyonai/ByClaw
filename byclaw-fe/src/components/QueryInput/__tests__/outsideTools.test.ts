import fs from 'fs';
import path from 'path';

describe('query input outside toolbar visibility', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
  const outsideTools = styles.slice(styles.indexOf('.outsideTools {'), styles.indexOf('.toolsMenu {'));

  it('only hides mention and skill entries collected by the plus menu', () => {
    // Jest 不渲染真实 Less；直接约束隐藏规则，防止省略 @ 或达到附件上限后控件位置变化造成误隐藏。
    expect(outsideTools).not.toMatch(/nth-child|nth-of-type/);
    expect(outsideTools).toMatch(
      /\.@\{antPrefix\}-space-item:has\(\[data-query-input-tool='mention'\]\),\s*\.@\{antPrefix\}-space-item:has\(\[data-query-input-tool='skill'\]\)\s*\{\s*display:\s*none;\s*\}/
    );
    expect(outsideTools.match(/display:\s*none;/g)).toHaveLength(2);
  });

  it.each(['Chat/index.tsx', 'Employees/index.tsx'])(
    'identifies hidden resource shortcuts without marking the upload button in %s',
    (relativePath) => {
      const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

      expect(source).toMatch(/<span\s+aria-label=\{mentionDigitalEmployeeTip\}\s+data-query-input-tool="mention"/);
      expect(source).toMatch(
        /<span\s+aria-label=\{getIntl\(\)\.formatMessage\(\{ id: 'queryInput.tools.skill' \}\)\}\s+data-query-input-tool="skill"/
      );
      expect(source.match(/data-query-input-tool=/g)).toHaveLength(2);
      expect(source).toMatch(/this\.checkCanUploadFile\(\) && \(\s*<UploadFile/);
    }
  );

  it('keeps employee detail fixed to its employee while using the same upload control', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../../pages/employees/index.tsx'), 'utf8');
    const employeeInput = fs.readFileSync(path.resolve(__dirname, '../Employees/index.tsx'), 'utf8');

    expect(page).toMatch(/\s+cannotAt\s+disableInputDraft/);
    expect(employeeInput).toMatch(/!cannotAt && \(\s*<MentionPopover/);
    expect(employeeInput).toMatch(/this\.checkCanUploadFile\(\) && \(\s*<UploadFile/);
  });
});
