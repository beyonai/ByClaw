module.exports = {
  extends: require.resolve('@umijs/max/eslint'),
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',
    semi: 2,
    'lines-around-comment': 2,
    'react/jsx-indent': [2, 2],
    indent: [2, 2, { SwitchCase: 1 }],
    // 禁用与 TypeScript 泛型箭头函数类型不兼容的规则
    'no-spaced-func': 'off',
    'func-call-spacing': 'off',
  },
};
