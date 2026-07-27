import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { createApplication } from "./runtime.js";

const config = loadConfig();
const application = await createApplication(config);

/** 收到进程信号时走应用的幂等关闭流程。 */
const shutdown = async () => {
  await application.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await application.start();
} catch (error) {
  application.app.log.error(error, "Failed to start byclaw-super");
  await application.close();
  process.exitCode = 1;
}
