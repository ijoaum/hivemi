import { serve } from "@hono/node-server";
import app from "./routes.js";
import { logger } from "./lib/logger.js";

const port = parseInt(process.env.PORT || "4001");

logger.info({ port }, "Starting HiveMI Registry...");

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  logger.info({ port: info.port }, "🐝 HiveMI Registry running");
});
