import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const HIVEMI_SECRET = process.env.HIVEMI_SECRET;

export const authMiddleware = createMiddleware(async (c, next) => {
  // Skip auth for health checks
  if (c.req.path === "/health") {
    return next();
  }

  // In development without secret, allow all
  if (!HIVEMI_SECRET) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  
  if (!authHeader) {
    throw new HTTPException(401, { message: "Missing Authorization header" });
  }

  const [scheme, token] = authHeader.split(" ");
  
  if (scheme !== "Bearer" || token !== HIVEMI_SECRET) {
    throw new HTTPException(403, { message: "Invalid credentials" });
  }

  return next();
});
