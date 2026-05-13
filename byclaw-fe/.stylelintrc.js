module.exports = {
  customSyntax: 'postcss-less', // 根据实际语法替换
  // extends: require.resolve('@umijs/max/stylelint'),
  rules: {
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['global', 'local'] }, // 允许CSS Modules语法
    ],
  },
};
