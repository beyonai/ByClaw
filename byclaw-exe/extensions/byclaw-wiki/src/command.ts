import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

export type RunCommandOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  maxOutputBytes: number;
};

function appendChunk(current: Buffer, chunk: Buffer, maxBytes: number): { buffer: Buffer; truncated: boolean } {
  if (current.byteLength >= maxBytes) {
    return { buffer: current, truncated: true };
  }
  const available = maxBytes - current.byteLength;
  if (chunk.byteLength <= available) {
    return { buffer: Buffer.concat([current, chunk]), truncated: false };
  }
  return { buffer: Buffer.concat([current, chunk.subarray(0, available)]), truncated: true };
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const startedAt = Date.now();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let truncated = false;
  let timedOut = false;

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000).unref();
    }, options.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer | string) => {
      const result = appendChunk(stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), options.maxOutputBytes);
      stdout = result.buffer;
      truncated = truncated || result.truncated;
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const result = appendChunk(stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), options.maxOutputBytes);
      stderr = result.buffer;
      truncated = truncated || result.truncated;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command,
        args,
        cwd: options.cwd,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        stdout: stdout.toString("utf8"),
        stderr: error instanceof Error ? error.message : String(error),
        timedOut,
        truncated,
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        command,
        args,
        cwd: options.cwd,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        truncated,
      });
    });
  });
}

export function commandSummary(result: CommandResult): string {
  const suffix = result.timedOut ? " timed out" : ` exited ${result.exitCode ?? "without exit code"}`;
  const stderr = result.stderr.trim();
  return `${result.command} ${result.args.join(" ")}${suffix}${stderr ? `: ${stderr}` : ""}`;
}
