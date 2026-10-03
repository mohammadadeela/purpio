import IORedis from "ioredis";
import { Queue } from "bullmq";
import { env } from "./env.js";
export const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const connection = { connection: redis };
export const buildQueue = new Queue("build", connection);
export const mediaQueue = new Queue("media", connection);
export const deployQueue = new Queue("deploy", connection);
export const emailQueue = new Queue("email", connection);
export const billingQueue = new Queue("billing", connection);
/** small typed cache helper */
export async function cached<T>(key: string, ttlS: number, fn: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key); if (hit) return JSON.parse(hit) as T;
  const v = await fn(); await redis.set(key, JSON.stringify(v), "EX", ttlS); return v;
}
