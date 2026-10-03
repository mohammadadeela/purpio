import { Worker, Queue } from "bullmq";
import { sendEmail, type TemplateKey } from "@purpio/email";
import { redis } from "../../api/src/lib/redis.js";
import { prisma } from "./lib.js";
import { runBuild } from "./processors/build.js";
import { runMedia } from "./processors/media.js";
import { runDeploy } from "./processors/deploy.js";
import { runBilling } from "./processors/billing.js";

const connection = { connection: redis };
new Worker("build", runBuild, { ...connection, concurrency: 4, lockDuration: 15 * 60_000 });
new Worker("media", runMedia, { ...connection, concurrency: 4, lockDuration: 15 * 60_000 });
new Worker("deploy", runDeploy, { ...connection, concurrency: 2, lockDuration: 20 * 60_000 });
new Worker("billing", runBilling, { ...connection, concurrency: 1 });
new Worker<{ to: string; key: TemplateKey; params: any }>("email", async (job) => {
  const r = await sendEmail(job.data.to, job.data.key, job.data.params);
  const user = await prisma.user.findUnique({ where: { email: job.data.to } });
  await prisma.emailLog.create({ data: { userId: user?.id, template: job.data.key, to: job.data.to, subject: r.subject, status: r.error ? "failed" : "sent", providerId: r.providerId } });
  if (r.error) throw new Error(r.error);
}, { ...connection, concurrency: 10 });

// Billing cron: hourly
const billingQueue = new Queue("billing", connection);
await billingQueue.add("cycle", {}, { repeat: { pattern: "0 * * * *" }, jobId: "billing-cycle" });
console.log("Purpio worker up: build, media, deploy, email, billing");
