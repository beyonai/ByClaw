import fs from 'fs';
import path from 'path';

describe('digital employee group editor layout', () => {
  const configFormSource = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');

  it('renders group members in the resource configuration column and hides ordinary resource sections', () => {
    const resourceSectionMarker = configFormSource.indexOf("{/* {digitalType === 'FROM_MANUALLY' && ( */}");
    const resourceSectionEnd = configFormSource.indexOf('{/* )} */}', resourceSectionMarker);

    expect(resourceSectionMarker).toBeGreaterThanOrEqual(0);
    expect(resourceSectionEnd).toBeGreaterThan(resourceSectionMarker);

    const resourceSection = configFormSource.slice(resourceSectionMarker, resourceSectionEnd);
    expect(resourceSection).toContain('{isEmployeeGroup && (');
    expect(resourceSection).toContain('<EmployeeGroupMembers');
    expect(resourceSection.indexOf('<EmployeeGroupMembers')).toBeLessThan(
      resourceSection.indexOf('employeeDetail.configureKnowledge')
    );
    expect(resourceSection).toContain('<div className={styles.knowledgeSection} hidden={isEmployeeGroup}>');
    expect(resourceSection.match(/<div className=\{styles\.skillsSection\} hidden=\{isEmployeeGroup\}>/g)).toHaveLength(
      3
    );
    expect(resourceSection).toContain('<div className={styles.robotSection} hidden={isEmployeeGroup}>');
    expect(configFormSource.match(/<EmployeeGroupMembers/g)).toHaveLength(1);
  });

  it('uses the configure group members title', () => {
    const zhLocale = fs.readFileSync(path.resolve(__dirname, '../../../../../../../locales/zh-CN.ts'), 'utf8');
    const enLocale = fs.readFileSync(path.resolve(__dirname, '../../../../../../../locales/en-US.ts'), 'utf8');

    expect(zhLocale).toContain("'employeeDetail.groupMember.title': '配置组成员'");
    expect(enLocale).toContain("'employeeDetail.groupMember.title': 'Configure Group Members'");
  });
});
