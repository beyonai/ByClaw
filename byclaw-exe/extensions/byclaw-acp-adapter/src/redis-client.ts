import net from "node:net";
import { REDIS_COMMANDS, REDIS_RESP } from "./constants.js";
import type { RedisConnectionConfig } from "./types.js";

type RedisReply = string | number | null | RedisReply[];

function encodeCommand(parts: Array<string | number>): Buffer {
  const chunks = [`${REDIS_RESP.array}${parts.length}${REDIS_RESP.crlf}`];
  for (const part of parts) {
    const value = String(part);
    chunks.push(`${REDIS_RESP.bulkString}${Buffer.byteLength(value)}${REDIS_RESP.crlf}${value}${REDIS_RESP.crlf}`);
  }
  return Buffer.from(chunks.join(""), "utf8");
}

class RespParser {
  private buffer = Buffer.alloc(0);

  append(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  read(): RedisReply | undefined {
    const parsed = this.parseAt(0);
    if (!parsed) {
      return undefined;
    }
    this.buffer = this.buffer.subarray(parsed.offset);
    return parsed.value;
  }

  private parseAt(offset: number): { value: RedisReply; offset: number } | undefined {
    if (offset >= this.buffer.length) {
      return undefined;
    }
    const prefix = String.fromCharCode(this.buffer[offset]);
    const lineEnd = this.buffer.indexOf(REDIS_RESP.crlf, offset);
    if (lineEnd < 0) {
      return undefined;
    }
    const line = this.buffer.subarray(offset + REDIS_RESP.protocolOffset, lineEnd).toString("utf8");
    const next = lineEnd + REDIS_RESP.lineTerminatorBytes;

    if (prefix === REDIS_RESP.simpleString) {
      return { value: line, offset: next };
    }
    if (prefix === REDIS_RESP.error) {
      throw new Error(`Redis error: ${line}`);
    }
    if (prefix === REDIS_RESP.integer) {
      return { value: Number(line), offset: next };
    }
    if (prefix === REDIS_RESP.bulkString) {
      const length = Number(line);
      if (length < REDIS_RESP.nullLength) {
        return { value: null, offset: next };
      }
      const end = next + length;
      if (this.buffer.length < end + REDIS_RESP.lineTerminatorBytes) {
        return undefined;
      }
      return {
        value: this.buffer.subarray(next, end).toString("utf8"),
        offset: end + REDIS_RESP.lineTerminatorBytes,
      };
    }
    if (prefix === REDIS_RESP.array) {
      const length = Number(line);
      if (length < REDIS_RESP.nullLength) {
        return { value: null, offset: next };
      }
      const items: RedisReply[] = [];
      let cursor = next;
      for (let index = 0; index < length; index += 1) {
        const parsed = this.parseAt(cursor);
        if (!parsed) {
          return undefined;
        }
        items.push(parsed.value);
        cursor = parsed.offset;
      }
      return { value: items, offset: cursor };
    }
    throw new Error(`Unsupported Redis RESP prefix: ${prefix}`);
  }
}

export class RedisClient {
  private socket?: net.Socket;
  private connectPromise?: Promise<void>;
  private parser = new RespParser();
  private waiters: Array<{ resolve: (value: RedisReply) => void; reject: (error: Error) => void }> =
    [];

  constructor(private readonly config: RedisConnectionConfig) {}

  async connect(): Promise<void> {
    if (this.socket) {
      if (this.connectPromise) {
        await this.connectPromise;
      }
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = this.openAndAuthenticate();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private async openAndAuthenticate(): Promise<void> {
    const socket = net.createConnection({
      host: this.config.host,
      port: this.config.port,
    });
    this.socket = socket;
    socket.setTimeout(this.config.connectTimeoutMs);
    socket.on("data", (chunk) => {
      try {
        this.parser.append(chunk);
        for (;;) {
          const reply = this.parser.read();
          if (reply === undefined) {
            break;
          }
          const waiter = this.waiters.shift();
          if (waiter) {
            waiter.resolve(reply);
          }
        }
      } catch (error) {
        this.rejectPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error) => this.rejectPending(error));
    socket.on("timeout", () => {
      socket.destroy(new Error("Redis connection timed out."));
    });
    socket.on("close", () => {
      this.socket = undefined;
      this.rejectPending(new Error("Redis connection closed."));
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    if (this.config.password) {
      if (this.config.username) {
        await this.sendCommand(REDIS_COMMANDS.auth, this.config.username, this.config.password);
      } else {
        await this.sendCommand(REDIS_COMMANDS.auth, this.config.password);
      }
    }
    if (this.config.database > 0) {
      await this.sendCommand(REDIS_COMMANDS.select, this.config.database);
    }
  }

  async command(...parts: Array<string | number>): Promise<RedisReply> {
    await this.connect();
    return await this.sendCommand(...parts);
  }

  private async sendCommand(...parts: Array<string | number>): Promise<RedisReply> {
    const socket = this.socket;
    if (!socket) {
      throw new Error("Redis socket is not connected.");
    }
    return await new Promise<RedisReply>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      socket.write(encodeCommand(parts));
    });
  }

  async get(key: string): Promise<string | null> {
    const reply = await this.command(REDIS_COMMANDS.get, this.withPrefix(key));
    return typeof reply === "string" ? reply : null;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const reply = await this.command(REDIS_COMMANDS.hget, this.withPrefix(key), field);
    return typeof reply === "string" ? reply : null;
  }

  async keys(pattern: string): Promise<string[]> {
    const reply = await this.command(REDIS_COMMANDS.keys, this.withPrefix(pattern));
    if (!Array.isArray(reply)) {
      return [];
    }
    return reply.filter((item): item is string => typeof item === "string").map((key) => this.stripPrefix(key));
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) {
      return [];
    }
    const reply = await this.command(REDIS_COMMANDS.mget, ...keys.map((key) => this.withPrefix(key)));
    if (!Array.isArray(reply)) {
      return [];
    }
    return reply.map((item) => (typeof item === "string" ? item : null));
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  private withPrefix(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private stripPrefix(key: string): string {
    return this.config.keyPrefix && key.startsWith(this.config.keyPrefix)
      ? key.slice(this.config.keyPrefix.length)
      : key;
  }

  private rejectPending(error: Error): void {
    const pending = this.waiters.splice(0);
    for (const waiter of pending) {
      waiter.reject(error);
    }
  }
}
