import { serve } from "@hono/node-server";
import app from "./routes.js";
import { logger } from "./lib/logger.js";

const port = parseInt(process.env.PORT || "4000");
// BIND_ADDRESS controls which interface the manager listens on.
// In production behind a reverse proxy, bind to 127.0.0.1 or a private VPC IP.
// Default: 0.0.0.0 (all interfaces) since the Manager is the external entry point.
const host = process.env.BIND_ADDRESS || "0.0.0.0";

logger.info({ port, host }, "Starting HiveMI Manager...");

serve({
  fetch: app.fetch,
  port,
  hostname: host,
}, (info) => {
  logger.info({ port: info.port, host }, "🐝 HiveMI Manager running");
});
