import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { env } from "./lib/env.js";
import { redis } from "./lib/redis.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { billingRoutes } from "./routes/billing.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";

const app = Fastify({ logger: { level: env.NODE_ENV === "production" ? "info" : "debug" }, trustProxy: true });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: [env.APP_URL], credentials: true });
await app.register(cookie, { secret: env.SESSION_SECRET });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute", redis });
await app.register(websocket);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: "Check the highlighted fields", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  app.log.error(err);
  return reply.code((err as any).statusCode ?? 500).send({ error: env.NODE_ENV === "production" ? "Something went wrong on our side. Try again." : err.message });
});

app.get("/health", async () => ({ ok: true, ts: Date.now() }));
await app.register(authRoutes);
await app.register(projectRoutes);
await app.register(billingRoutes);
await app.register(accountRoutes);
await app.register(adminRoutes);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
