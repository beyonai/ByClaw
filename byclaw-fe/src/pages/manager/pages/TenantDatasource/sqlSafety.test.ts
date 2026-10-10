import { requiresSqlConfirmation } from './sqlSafety';

describe('tenant SQL confirmation', () => {
  it.each([
    'DELETE FROM byai.sample',
    'DROP TABLE byai.sample',
    'TRUNCATE byai.sample',
    'WITH removed AS (DELETE FROM byai.sample RETURNING id) SELECT * FROM removed',
    'EXPLAIN ANALYZE DELETE FROM byai.sample',
    'SELECT * INTO byai.backup FROM byai.sample',
    "WITH note AS (SELECT '--' AS value), removed AS (DELETE FROM byai.sample RETURNING id) SELECT * FROM removed",
    'WITH note AS (SELECT $$--$$ AS value), removed AS (DELETE FROM byai.sample RETURNING id) SELECT * FROM removed',
  ])('requires confirmation for %s', (sql) => {
    expect(requiresSqlConfirmation(sql)).toBe(true);
  });

  it.each([
    "SELECT 'drop table' AS note",
    '/* note */ SELECT * FROM byai.sample',
    'WITH sample AS (SELECT 1) SELECT * FROM sample',
    'SHOW search_path',
    '/* DELETE */ SELECT 1',
  ])('runs read only query without confirmation: %s', (sql) => {
    expect(requiresSqlConfirmation(sql)).toBe(false);
  });
});
