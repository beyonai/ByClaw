const Module = require('module');

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'canvas') {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

const JSDOMEnvironment = require('jest-environment-jsdom').TestEnvironment;

module.exports = JSDOMEnvironment;
