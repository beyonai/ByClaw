import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

const transform = require('../loaders/raw-bigint-literals');

describe('RAW dependency BigInt syntax compatibility', () => {
  it('preserves exact large integer arithmetic without rewriting strings or comments', () => {
    const source = `// Keep 123n in comments.
      const label = '456n';
      const result = (0xffff_ffff_ffff_ffffn + 1n) >> 32n;
      const negative = -9n;`;
    const output = transform.call({ cacheable: jest.fn() }, source);
    expect(output).toContain('// Keep 123n in comments.');
    expect(output).toContain("const label = '456n';");
    const literals: unknown[] = [];
    traverse(parse(output), {
      BigIntLiteral: (node) => {
        literals.push(node);
      },
    });
    expect(literals).toHaveLength(0);
    const evaluate = (code: string) => new Function(`${code}; return { result, negative, label };`)();
    expect(evaluate(output)).toEqual(evaluate(source));
  });

  it('leaves modules without BigInt literals unchanged', () => {
    const source = 'export const value = 123;';
    expect(transform.call({}, source)).toBe(source);
  });
});
