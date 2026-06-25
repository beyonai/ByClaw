const myGetArgvOptions = require('../getArgvOptions');

describe('getArgvOptions', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses build options with leading dashes', () => {
    process.argv = ['node', 'max', 'build', '--', '--publicPath=/dist/', '--runtime'];

    expect(myGetArgvOptions()).toEqual({
      publicPath: '/dist/',
      runtime: true,
    });
  });

  it('parses build options without leading dashes', () => {
    process.argv = ['node', 'max', 'build', 'publicPath=/dist/', 'runtime'];

    expect(myGetArgvOptions()).toEqual({
      publicPath: '/dist/',
      runtime: true,
    });
  });
});
