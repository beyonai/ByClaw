import { readConfig } from "./config.js";
import { bootstrap } from "./bootstrap.js";

const config = readConfig();
const service = await bootstrap(config);
await service.app.listen({ host: config.host, port: config.port });
await service.runtime.start();
let stopping = false;
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
