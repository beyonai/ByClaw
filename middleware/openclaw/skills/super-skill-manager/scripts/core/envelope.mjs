export function successEnvelope({ source, data = [], warnings = [], elapsedMs = 0 }) {
  return {
    ok: true,
    source,
    data,
    warnings,
    elapsedMs,
  };
}

export function errorEnvelope({ source, code, message, elapsedMs = 0, data = [] }) {
  return {
    ok: false,
    source,
    data,
    error: {
      code,
      message,
    },
    elapsedMs,
  };
}

export function writeEnvelope(envelope, output = process.stdout) {
  output.write(`${JSON.stringify(envelope)}\n`);
}
