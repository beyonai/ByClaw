import "dotenv/config";
import { loadConfig } from "./config.js";
import { createApplication } from "./runtime.js";
import { loadKeyEncryptionService } from "./security/kms-adapter.js";

const config = loadConfig();
const keyEncryptionService = await loadKeyEncryptionService(config.kms);
const application = await createApplication(config, { keyEncryptionService });

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
