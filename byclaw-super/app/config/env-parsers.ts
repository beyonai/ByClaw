/**
 * 环境变量解析原子：每个函数都做严格校验并在非法输入时抛出带字段名的错误。
 * 仅供 config/index.ts 的 loadConfig 使用，不对外暴露为应用配置语义。
 */

/** 解析显式布尔环境变量，避免任意非空字符串被误判为开启。 */
export function booleanValue(raw: string, name: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1 or 0, received: ${raw}`);
}

/** 服务注册仅支持 HTTP(S) 协议。 */
export function discoveryProtocol(raw: string): "http" | "https" {
  const value = raw.trim().toLowerCase();
  if (value === "http" || value === "https") {
    return value;
  }
  throw new Error(
    `BYCLAW_SUPER_DISCOVERY_PROTOCOL must be http or https, received: ${raw}`,
  );
}

/** 校验并标准化服务发现路径前缀。 */
export function pathPrefix(raw: string, name: string): string {
  const value = raw.trim();
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must be an absolute path without query or hash`);
  }
  return value === "/" ? "/" : `/${value.replace(/^\/+|\/+$/g, "")}`;
}

/** 校验必须存在的文本环境变量，并返回去除首尾空白后的值。 */
export function nonEmpty(raw: string, name: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  return nonEmpty(env[name] ?? "", name);
}

export function requiredEnvEither(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`${names.join(" or ")} must be configured`);
}

export function redisConnectionMode(raw: string): "standalone" | "cluster" {
  const value = raw.trim().toLowerCase();
  if (value === "standalone" || value === "cluster") {
    return value;
  }
  throw new Error(
    `REDIS_MODE must be standalone or cluster, received: ${raw}`,
  );
}

export function redisClusterNodes(
  raw: string,
): Array<{ host: string; port: number }> {
  return raw.split(",").map((entry) => {
    const value = entry.trim();
    const separator = value.lastIndexOf(":");
    if (separator <= 0) {
      throw new Error(
        `Redis cluster node must use host:port format, received: ${value}`,
      );
    }
    const host = nonEmpty(value.slice(0, separator), "Redis cluster node host");
    const port = integer(
      value.slice(separator + 1),
      "Redis cluster node port",
      1,
      65_535,
    );
    return { host, port };
  });
}

/** 解析带上下界的整数环境变量，并在启动阶段给出明确错误。 */
export function integer(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, received: ${raw}`);
  }
  return value;
}

export function commaSeparated(raw: string): string[] {
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
}
