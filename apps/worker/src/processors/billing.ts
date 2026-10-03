/** Scheduled billing: renewals with dunning (day 1, 3, 5), reminders 3 days before, credit expiry, data exports. */
import type { Job } from "bullmq";
import { prisma } from "../lib.js";
import * as pp from "../../../api/src/services/paypal.js";
import * as credits from "../../../api/src/services/credits.js";
import { createInvoice } from "../../../api/src/services/invoices.js";
import { emailQueue } from "../../../api/src/lib/redis.js";
import { putObject } from "../../../api/src/services/storage.js";

export async function runBilling(job: Job<{ userId?: string }>) {
  if (job.name === "export") return exportUser(job.data.userId!);
  const now = new Date();
  // 3-day reminders
  const soon = await prisma.subscription.findMany({ where: { status: "active", autoRenew: true, cancelAtPeriodEnd: false, planKey: { not: "free" }, currentPeriodEnd: { gte: new Date(now.getTime() + 2.5 * 864e5), lte: new Date(now.getTime() + 3.5 * 864e5) } }, include: { user: true, plan: true } });
  for (const s of soon) await emailQueue.add("send", { to: s.user.email, key: "renewalReminder", params: { date: s.currentPeriodEnd.toDateString(), amount: `$${(s.plan.priceCents / 100).toFixed(2)}` } }, { jobId: `remind-${s.id}-${s.currentPeriodEnd.getTime()}` });
  // Renewals due (active) and retries (past_due on day 1,3,5)
  const due = await prisma.subscription.findMany({ where: { planKey: { not: "free" }, OR: [{ status: "active", currentPeriodEnd: { lte: now } }, { status: "past_due", retryCount: { lt: 3 } }] }, include: { user: true, plan: true } });
  for (const s of due) {
    if (s.cancelAtPeriodEnd || !s.autoRenew) { await downgrade(s.userId, s.user.email, s.currentPeriodEnd); continue; }
    if (s.status === "past_due") { const lastTry = s.updatedAt.getTime(); const gapDays = [1, 2, 2][s.retryCount] ?? 2; if (now.getTime() - lastTry < gapDays * 864e5) continue; }
    const pm = await prisma.paymentMethod.findFirst({ where: { userId: s.userId, isDefault: true, deletedAt: null } });
    let ok = false, orderId = "";
    if (pm) { try { const customId = `renew:${s.userId}:${s.planKey}:${s.currentPeriodEnd.getTime()}`; const o = await pp.chargeVault(pm.vaultToken, s.plan.priceCents / 100, `Purpio ${s.plan.name} plan renewal`, customId); ok = o.status === "COMPLETED"; orderId = o.id;
      if (ok) await prisma.payment.create({ data: { userId: s.userId, provider: "paypal", providerId: o.id, eventType: "renewal", amountCents: s.plan.priceCents, status: "completed", idempotencyKey: customId, raw: o as any } }); } catch (e) { ok = false; } }
    if (ok) {
      const start = new Date(), end = new Date(start); end.setMonth(end.getMonth() + 1);
      await prisma.subscription.update({ where: { id: s.id }, data: { status: "active", currentPeriodStart: start, currentPeriodEnd: end, retryCount: 0 } });
      await credits.grant(s.userId, s.plan.creditsPerPeriod, "plan_grant", { type: "plan", id: s.planKey, expiresAt: new Date(end.getTime() + 60 * 864e5) });
      const inv = await createInvoice(s.userId, s.plan.priceCents, [{ label: `${s.plan.name} plan, monthly renewal`, amountCents: s.plan.priceCents }], orderId, s.id);
      await emailQueue.add("send", { to: s.user.email, key: "receipt", params: { number: inv.number, amount: `$${(s.plan.priceCents / 100).toFixed(2)}`, pdf: inv.pdfUrl } });
    } else {
      const retry = s.status === "past_due" ? s.retryCount + 1 : 0;
      if (retry >= 3) await downgrade(s.userId, s.user.email, now);
      else { await prisma.subscription.update({ where: { id: s.id }, data: { status: "past_due", retryCount: retry } }); await emailQueue.add("send", { to: s.user.email, key: "renewalFailed", params: { retryDate: new Date(now.getTime() + ([1, 2, 2][retry] ?? 2) * 864e5).toDateString() } }); }
    }
  }
  // Resume paused
  await prisma.subscription.updateMany({ where: { status: "paused", pausedUntil: { lte: now } }, data: { status: "active", pausedUntil: null, currentPeriodEnd: now } });
  // Expire credits
  const expiring = await prisma.creditLedger.findMany({ where: { expiresAt: { lte: now }, reason: "plan_grant", refType: "plan" } });
  for (const row of expiring) { const bal = await credits.balance(row.userId); const toExpire = Math.min(bal.available, row.delta); if (toExpire > 0) await credits.grant(row.userId, -toExpire, "expiry", { note: `Expired grant ${row.id}` }); await prisma.creditLedger.update({ where: { id: row.id }, data: { refType: "plan_expired" } }); }
}
async function downgrade(userId: string, email: string, ends: Date) {
  await prisma.subscription.update({ where: { userId }, data: { planKey: "free", status: "active", cancelAtPeriodEnd: false, retryCount: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } });
  await emailQueue.add("send", { to: email, key: "cancelled", params: { ends: ends.toDateString() } });
}
async function exportUser(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const data = { user: u, projects: await prisma.project.findMany({ where: { workspace: { ownerId: userId } }, include: { messages: true, versions: { include: { files: true } }, media: true } }), ledger: await prisma.creditLedger.findMany({ where: { userId } }), invoices: await prisma.invoice.findMany({ where: { userId } }) };
  const url = await putObject(`exports/${userId}/${Date.now()}.json`, JSON.stringify(data, null, 2), "application/json", false);
  await emailQueue.add("send", { to: u.email, key: "dataExport", params: { link: url } });
}
