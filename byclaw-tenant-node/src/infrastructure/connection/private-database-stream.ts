import { Duplex } from "node:stream";
import { createWebSocketStream, WebSocket } from "ws";
import { DomainError } from "../../domain/errors.js";

export interface DatabaseTransport {
  url: string;
  trafficToken: string;
}

/** Only BE-verified private MicroVM database endpoints may back a pg connection. */
export function databaseStream(transport: DatabaseTransport) {
  const uri = new URL(transport.url);
  if (
    uri.protocol !== "wss:" ||
    !/^15432-[a-z0-9-]+\.[a-z0-9-]+-vpc\.sandbox\.aliyuncs\.com$/.test(uri.hostname) ||
    uri.pathname !== "/postgresql" ||
    uri.port ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash ||
    !transport.trafficToken ||
    /[\r\n]/.test(transport.trafficToken)
  )
    throw new DomainError("INVALID_PRIVATE_DATABASE_TRANSPORT");
  const websocket = new WebSocket(uri, {
    headers: { "e2b-traffic-access-token": transport.trafficToken },
    handshakeTimeout: 5000,
    perMessageDeflate: false,
    followRedirects: false,
    maxPayload: 4 * 1024 * 1024,
  });
  const wire = createWebSocketStream(websocket);
  const stream = new Duplex({
    read() {
      wire.resume();
    },
    write(data: Buffer, _encoding, callback) {
      let offset = 0;
      const next = (error?: Error | null) => {
        if (error) return callback(error);
        if (offset === data.length) return callback();
        const end = Math.min(data.length, offset + 65536);
        const part = data.subarray(offset, end);
        offset = end;
        wire.write(part, next);
      };
      next();
    },
    final(callback) {
      wire.end(callback);
    },
    destroy(error, callback) {
      wire.destroy();
      callback(error);
    },
  });
  wire.on("data", (bytes: Buffer) => {
    if (!stream.push(bytes)) wire.pause();
  });
  wire.on("end", () => stream.push(null));
  wire.on("error", () => stream.destroy(new DomainError("PRIVATE_DATABASE_TRANSPORT_FAILED")));
  wire.on("close", () => stream.destroy());
  // A remote WebSocket close can leave the intermediate Duplex half-open.
  // pg requires the socket close event to evict dead idle clients from its pool.
  websocket.on("close", () => stream.destroy());
  // pg expects a net.Socket-shaped stream. TLS terminates at the private gateway;
  // PostgreSQL authentication and the database/user identity probe remain mandatory.
  return Object.assign(stream, {
    connect() {
      if (websocket.readyState === WebSocket.OPEN) queueMicrotask(() => stream.emit("connect"));
      else websocket.once("open", () => stream.emit("connect"));
      return stream;
    },
    setNoDelay() {
      return stream;
    },
    setKeepAlive() {
      return stream;
    },
    ref() {
      return stream;
    },
    unref() {
      return stream;
    },
  });
}
