import { loadLocalEnv } from "./env-file.js";
import { prepareDevelopmentEnvironment } from "./development/environment.js";

// 先完成本地配置，再加载正式入口，保证依赖初始化也能看到最终环境变量。
loadLocalEnv();
prepareDevelopmentEnvironment();
console.info("Local development HTTPS: https://localhost:" + (process.env.PORT ?? "3100"));
await import("./main.js");
