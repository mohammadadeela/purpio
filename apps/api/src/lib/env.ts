import { z } from "zod";
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().url(), DATABASE_URL: z.string(), REDIS_URL: z.string(),
  SESSION_SECRET: z.string().min(32), MASTER_KEY: z.string().startsWith("base64:"),
  FIREBASE_PROJECT_ID: z.string(), FIREBASE_CLIENT_EMAIL: z.string(), FIREBASE_PRIVATE_KEY: z.string(),
  OPENAI_API_KEY: z.string().optional(), ANTHROPIC_API_KEY: z.string().optional(), GEMINI_API_KEY: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"), PAYPAL_CLIENT_ID: z.string(), PAYPAL_CLIENT_SECRET: z.string(), PAYPAL_WEBHOOK_ID: z.string(),
  RESEND_API_KEY: z.string().optional(), EMAIL_FROM: z.string().default("Purpio <hello@purpio.com>"),
  S3_ENDPOINT: z.string().optional(), S3_BUCKET: z.string().default("purpio"), S3_ACCESS_KEY_ID: z.string().optional(), S3_SECRET_ACCESS_KEY: z.string().optional(), CDN_URL: z.string().optional(),
  PREVIEW_DOMAIN: z.string().default("purpio.app"), CLOUDFLARE_API_TOKEN: z.string().optional(), CLOUDFLARE_ZONE_ID: z.string().optional(),
});
export const env = Env.parse(process.env);
