import { serve } from "@hono/node-server";
import app from "./routes.js";
import { logger } from "./lib/logger.js";

const port = parseInt(process.env.PORT || "4000");

logger.info({ port }, "Starting HiveMI Manager...");

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  logger.info({ port: info.port }, "🐝 HiveMI Manager running");
});
