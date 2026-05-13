module.exports = function getArgvOptions() {
  const argv = process.argv;
  const argvOptions: { [key: string]: string | number | boolean } = {};
  if (argv.length > 3) {
    const arg = process.argv.slice(3);

    arg.forEach(_arg => {
      if (_arg.indexOf('=') > -1) {
        const eq = _arg.split('=');
        argvOptions[eq[0]] = eq[1];
      } else {
        argvOptions[_arg] = _arg;
      }
    });
  }

  return argvOptions;
}
