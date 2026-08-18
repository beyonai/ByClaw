import fs from 'fs';
import path from 'path';

describe('digital employee group member selector performance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../EmployeeGroupMembers.tsx'), 'utf8');

  it('uses server-side paging instead of loading all candidates', () => {
    expect(source).toContain('const CANDIDATE_PAGE_SIZE = 30;');
    expect(source).toContain('pageNum,');
    expect(source).toContain('pageSize: CANDIDATE_PAGE_SIZE');
    expect(source).toContain('current: pageNum');
    expect(source).toContain('onChange={(nextPagination) => setPageNum(nextPagination.current || 1)}');
    expect(source).not.toContain('pageSize: 200');
    expect(source).not.toContain('pagination={false}');
  });

  it('caches pages briefly and cancels obsolete requests', () => {
    expect(source).toContain('const CANDIDATE_CACHE_TTL = 60 * 1000;');
    expect(source).toContain('candidateCacheRef.current.get(cacheKey)');
    expect(source).toContain('requestRef.current?.abort()');
    expect(source).toContain('const requestController = new AbortController();');
    expect(source).toMatch(/},\s*requestController\s*\)/);
  });

  it('keeps configured team roles when candidates are reloaded', () => {
    expect(source).toContain(
      'const existingMembers = new Map(members.map((member) => [`${member.resourceId}`, member]));'
    );
    expect(source).toContain('return existing ? { ...candidate, teamRole: existing.teamRole } : candidate;');
  });

  it('does not expose member ordering controls', () => {
    expect(source).not.toContain('ArrowUpOutlined');
    expect(source).not.toContain('ArrowDownOutlined');
    expect(source).not.toContain('const move =');
  });
});
