const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// 仅用于 RAW 解码依赖：保持原生 BigInt 运算，用构造函数表达字面量，
// 让主应用沿用原浏览器编译目标。缺少 BigInt 的运行环境在加载解码器前拦截。
module.exports = function rawBigintLiterals(source) {
  this.cacheable?.();
  const edits = [];
  traverse(parse(source, { sourceType: 'module' }), {
    BigIntLiteral({ node }) {
      edits.push({ start: node.start, end: node.end, value: node.value.replace(/_/g, '') });
    },
  });
  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (code, { start, end, value }) => code.slice(0, start) + `BigInt(${JSON.stringify(value)})` + code.slice(end),
      source
    );
};
