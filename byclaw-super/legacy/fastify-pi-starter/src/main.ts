import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PiService } from "./pi/pi.service.js";

const config = loadConfig();
const pi = new PiService(config);
await pi.initialize();

const app = await buildApp(config, pi);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
