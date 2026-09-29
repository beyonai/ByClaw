import { readConfig } from "./config.js";
import { bootstrap } from "./bootstrap.js";
import { loadLocalEnv } from "./env-file.js";

loadLocalEnv();
const config = readConfig();
const service = await bootstrap(config);
await service.app.listen({ host: config.host, port: config.port });
await service.runtime.start();
let stopping = false;
/** 停止接收与消费，等待在途任务收尾，再释放连接；重复退出信号不重复触发关闭。 */
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await service.close();
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
