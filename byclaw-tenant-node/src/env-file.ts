import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** 加载模块根目录的本地 .env；已有环境变量优先，线上可以仅使用容器注入。 */
export function loadLocalEnv(path = fileURLToPath(new URL("../.env", import.meta.url))): void {
  try {
    loadEnvFile(path);
  } catch (error) {
    // 缺少本地文件允许继续；权限或读取错误应明确阻止启动。
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
