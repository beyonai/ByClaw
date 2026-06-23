module.exports = function getArgvOptions() {
  const argv = process.argv;
  const argvOptions: { [key: string]: string | number | boolean } = {};
  if (argv.length > 3) {
    const arg = process.argv.slice(3);

    arg.forEach((_arg) => {
      if (_arg === '--') {
        return;
      }

      const normalizedArg = _arg.replace(/^--?/, '');

      if (_arg.indexOf('=') > -1) {
        const eq = normalizedArg.split('=');
        argvOptions[eq[0]] = eq[1];
      } else {
        argvOptions[normalizedArg] = true;
      }
    });
  }

  return argvOptions;
};
