import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@purpio/db";
import { requireUser } from "../lib/auth.js";
import { emailQueue } from "../lib/redis.js";
import * as pp from "../services/paypal.js";
import * as credits from "../services/credits.js";
import { createInvoice } from "../services/invoices.js";

export async function billingRoutes(app: FastifyInstance) {
  app.get("/billing/catalog", async () => ({ plans: await prisma.plan.findMany({ where: { active: true }, orderBy: { sort: "asc" } }), packs: await prisma.creditPack.findMany({ where: { active: true }, orderBy: { sort: "asc" } }) }));
  app.get("/billing", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const [sub, bal, cards, invoices] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId: u.id }, include: { plan: true } }), credits.balance(u.id),
      prisma.paymentMethod.findMany({ where: { userId: u.id, deletedAt: null }, select: { id: true, provider: true, brand: true, last4: true, expMonth: true, expYear: true, isDefault: true, billingAddress: true } }),
      prisma.invoice.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]); return { subscription: sub, credits: bal, paymentMethods: cards, invoices }; });
  app.get("/billing/usage", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const since = new Date(Date.now() - 30 * 864e5);
    const rows = await prisma.creditLedger.findMany({ where: { userId: u.id, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } });
    const byDay: Record<string, number> = {}; for (const r of rows) if (r.delta < 0) { const d = r.createdAt.toISOString().slice(0, 10); byDay[d] = (byDay[d] ?? 0) - r.delta; }
    const byModel = await prisma.chatMessage.groupBy({ by: ["modelKey"], where: { userId: u.id, createdAt: { gte: since } }, _sum: { creditsUsed: true } });
    const byProject = await prisma.chatMessage.groupBy({ by: ["projectId"], where: { userId: u.id, createdAt: { gte: since } }, _sum: { creditsUsed: true }, orderBy: { _sum: { creditsUsed: "desc" } }, take: 10 });
    return { balance: await credits.balance(u.id), byDay, byModel, byProject, ledger: rows.slice(-200) }; });

  /** Coupon check */
  app.post("/billing/coupon", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const { code } = z.object({ code: z.string() }).parse(req.body);
    const c = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!c || !c.active || (c.expiresAt && c.expiresAt < new Date()) || (c.maxUses && c.uses >= c.maxUses)) return reply.code(400).send({ error: "That code is not valid" });
    return { code: c.code, pctOff: c.pctOff, creditsBonus: c.creditsBonus }; });

  /** Step 1 for a pack or first subscription charge: create the PayPal order the browser confirms with card fields / Google Pay / PayPal. */
  app.post("/billing/orders", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const b = z.object({ packKey: z.string().optional(), planKey: z.string().optional(), coupon: z.string().optional(), saveCard: z.boolean().default(true) }).parse(req.body);
    let amount = 0, desc = "", customId = "";
    if (b.packKey) { const p = await prisma.creditPack.findUniqueOrThrow({ where: { key: b.packKey } }); amount = p.priceCents; desc = `Purpio ${p.name}`; customId = `pack:${u.id}:${p.key}:${Date.now()}`; }
    else if (b.planKey) { const p = await prisma.plan.findUniqueOrThrow({ where: { key: b.planKey } }); amount = p.priceCents; desc = `Purpio ${p.name} plan, first month`; customId = `plan:${u.id}:${p.key}:${Date.now()}`; }
    else return reply.code(400).send({ error: "Choose a plan or a pack" });
    if (b.coupon) { const c = await prisma.coupon.findUnique({ where: { code: b.coupon.toUpperCase() } }); if (c?.pctOff) amount = Math.round(amount * (100 - c.pctOff) / 100); }
    const order = await pp.createOrder(amount / 100, desc, customId, b.saveCard);
    return { orderId: order.id, amountCents: amount }; });

  /** Step 2: capture. Idempotent; the webhook is the final truth but this gives instant feedback. */
  app.post("/billing/orders/:id/capture", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const cap = await pp.captureOrder((req.params as any).id);
    if (cap.status !== "COMPLETED") return reply.code(402).send({ error: "Your bank declined this payment. Try another card or PayPal." });
    const c = cap.purchase_units[0].payments.captures[0]; const amountCents = Math.round(Number(c.amount.value) * 100);
    const exists = await prisma.payment.findUnique({ where: { idempotencyKey: `cap:${c.id}` } }); if (exists) return { ok: true, duplicate: true };
    const vault = cap.payment_source?.card?.attributes?.vault?.id;
    if (vault) { const card = cap.payment_source!.card!; const [y, m] = (card.expiry ?? "-").split("-");
      const n = await prisma.paymentMethod.count({ where: { userId: u.id, deletedAt: null } });
      await prisma.paymentMethod.create({ data: { userId: u.id, provider: "paypal_card", vaultToken: vault, brand: card.brand, last4: card.last_digits, expMonth: Number(m) || null, expYear: Number(y) || null, isDefault: n === 0 } }); }
    const body = req.body as { packKey?: string; planKey?: string; coupon?: string };
    await prisma.payment.create({ data: { userId: u.id, provider: "paypal", providerId: c.id, eventType: "capture", amountCents, status: "completed", idempotencyKey: `cap:${c.id}`, raw: cap as any } });
    if (body.packKey) { const p = await prisma.creditPack.findUniqueOrThrow({ where: { key: body.packKey } });
      await credits.grant(u.id, p.credits, "topup", { type: "pack", id: p.key }); const inv = await createInvoice(u.id, amountCents, [{ label: p.name, amountCents }], cap.id);
      await emailQueue.add("send", { to: u.email, key: "receipt", params: { number: inv.number, amount: `$${(amountCents / 100).toFixed(2)}`, pdf: inv.pdfUrl } });
      await emailQueue.add("send", { to: u.email, key: "topup", params: { credits: p.credits } }); return { ok: true, credits: p.credits, invoice: inv.number }; }
    if (body.planKey) { const p = await prisma.plan.findUniqueOrThrow({ where: { key: body.planKey } }); const now = new Date(), end = new Date(now); end.setMonth(end.getMonth() + 1);
      const prev = await prisma.subscription.findUnique({ where: { userId: u.id }, include: { plan: true } });
      await prisma.subscription.upsert({ where: { userId: u.id }, update: { planKey: p.key, status: "active", currentPeriodStart: now, currentPeriodEnd: end, cancelAtPeriodEnd: false, autoRenew: true, retryCount: 0 }, create: { userId: u.id, planKey: p.key, currentPeriodStart: now, currentPeriodEnd: end } });
      // upgrade mid-period: grant the difference immediately; downgrade: full new grant at renewal (handled by worker)
      const grantNow = prev && prev.plan.priceCents > 0 && p.priceCents > prev.plan.priceCents ? Math.max(0, p.creditsPerPeriod - prev.plan.creditsPerPeriod) : p.creditsPerPeriod;
      await credits.grant(u.id, grantNow, "plan_grant", { type: "plan", id: p.key, expiresAt: new Date(end.getTime() + 60 * 864e5) });
      if (body.coupon) await prisma.coupon.update({ where: { code: body.coupon.toUpperCase() }, data: { uses: { increment: 1 } } }).catch(() => {});
      const inv = await createInvoice(u.id, amountCents, [{ label: `${p.name} plan, monthly`, amountCents }], cap.id);
      await emailQueue.add("send", { to: u.email, key: "receipt", params: { number: inv.number, amount: `$${(amountCents / 100).toFixed(2)}`, pdf: inv.pdfUrl } });
      await emailQueue.add("send", { to: u.email, key: "planActive", params: { plan: p.name, credits: grantNow, renews: end.toDateString() } });
      const ref = await prisma.referral.findFirst({ where: { referredId: u.id, status: "pending" } });
      if (ref) { await prisma.referral.update({ where: { id: ref.id }, data: { status: "rewarded", rewardedAt: new Date() } }); await credits.grant(ref.referrerId, ref.rewardCredits, "referral"); await credits.grant(u.id, ref.rewardCredits, "referral");
        const r = await prisma.user.findUnique({ where: { id: ref.referrerId } }); if (r) await emailQueue.add("send", { to: r.email, key: "referralReward", params: { credits: ref.rewardCredits } }); }
      return { ok: true, plan: p.key, credits: grantNow, invoice: inv.number }; }
    return { ok: true }; });

  /** One-tap top-up with the default saved card (used by the "out of credits" sheet). */
  app.post("/billing/topup", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const { packKey } = z.object({ packKey: z.string() }).parse(req.body);
    const pm = await prisma.paymentMethod.findFirst({ where: { userId: u.id, isDefault: true, deletedAt: null } }); if (!pm) return reply.code(400).send({ error: "Add a card first", needsCard: true });
    const p = await prisma.creditPack.findUniqueOrThrow({ where: { key: packKey } }); const customId = `topup:${u.id}:${p.key}:${Date.now()}`;
    const order = await pp.chargeVault(pm.vaultToken, p.priceCents / 100, `Purpio ${p.name}`, customId);
    if (order.status !== "COMPLETED") return reply.code(402).send({ error: "Your bank declined this charge. Try another card." });
    await prisma.payment.create({ data: { userId: u.id, provider: "paypal", providerId: order.id, eventType: "vault_capture", amountCents: p.priceCents, status: "completed", idempotencyKey: customId, raw: order as any } });
    await credits.grant(u.id, p.credits, "topup", { type: "pack", id: p.key }); const inv = await createInvoice(u.id, p.priceCents, [{ label: p.name, amountCents: p.priceCents }], order.id);
    await emailQueue.add("send", { to: u.email, key: "receipt", params: { number: inv.number, amount: `$${(p.priceCents / 100).toFixed(2)}`, pdf: inv.pdfUrl } });
    return { ok: true, credits: p.credits, balance: await credits.balance(u.id) }; });

  app.patch("/billing/subscription", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const b = z.object({ autoRenew: z.boolean().optional(), cancelAtPeriodEnd: z.boolean().optional(), pauseMonths: z.number().min(1).max(3).optional(), resume: z.boolean().optional() }).parse(req.body);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: u.id } }); const data: any = {};
    if (b.autoRenew !== undefined) data.autoRenew = b.autoRenew;
    if (b.cancelAtPeriodEnd !== undefined) { data.cancelAtPeriodEnd = b.cancelAtPeriodEnd; if (b.cancelAtPeriodEnd) await emailQueue.add("send", { to: u.email, key: "cancelled", params: { ends: sub.currentPeriodEnd.toDateString() } }); }
    if (b.pauseMonths) { const until = new Date(sub.currentPeriodEnd); until.setMonth(until.getMonth() + b.pauseMonths); data.status = "paused"; data.pausedUntil = until; }
    if (b.resume) { data.status = "active"; data.pausedUntil = null; }
    return prisma.subscription.update({ where: { userId: u.id }, data }); });
  app.patch("/billing/payment-methods/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const id = (req.params as any).id;
    await prisma.$transaction([prisma.paymentMethod.updateMany({ where: { userId: u.id }, data: { isDefault: false } }), prisma.paymentMethod.updateMany({ where: { id, userId: u.id }, data: { isDefault: true } })]); return { ok: true }; });
  app.delete("/billing/payment-methods/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const pm = await prisma.paymentMethod.findFirst({ where: { id: (req.params as any).id, userId: u.id } }); if (!pm) return reply.code(404).send({ error: "Card not found" });
    await pp.deleteVault(pm.vaultToken).catch(() => {}); await prisma.paymentMethod.update({ where: { id: pm.id }, data: { deletedAt: new Date(), isDefault: false } }); return { ok: true }; });
  app.patch("/billing/details", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const d = z.object({ company: z.string().max(120).optional(), vat: z.string().max(40).optional(), address: z.string().max(300).optional() }).parse(req.body);
    await prisma.user.update({ where: { id: u.id }, data: { prefs: { ...(u.prefs as object), ...d } } }); return { ok: true }; });
  app.post("/billing/invoices/:id/resend", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const inv = await prisma.invoice.findFirst({ where: { id: (req.params as any).id, userId: u.id } }); if (!inv) return reply.code(404).send({ error: "Invoice not found" });
    await emailQueue.add("send", { to: u.email, key: "receipt", params: { number: inv.number, amount: `$${(inv.amountCents / 100).toFixed(2)}`, pdf: inv.pdfUrl } }); return { ok: true }; });

  /** PayPal webhooks: verified, idempotent, source of truth. */
  app.post("/billing/webhooks/paypal", async (req, reply) => {
    const body = req.body as any; if (!(await pp.verifyWebhook(req.headers as any, body))) return reply.code(400).send({ error: "bad signature" });
    const key = `wh:${body.id}`; if (await prisma.payment.findUnique({ where: { idempotencyKey: key } })) return { ok: true };
    const res = body.resource ?? {}; const customId: string = res.custom_id ?? res.purchase_units?.[0]?.custom_id ?? ""; const userId = customId.split(":")[1];
    if (userId) await prisma.payment.create({ data: { userId, provider: "paypal", providerId: res.id ?? body.id, eventType: body.event_type, amountCents: Math.round(Number(res.amount?.value ?? res.billing_info?.last_payment?.amount?.value ?? 0) * 100), status: body.event_type, idempotencyKey: key, raw: body } });
    switch (body.event_type) {
      case "PAYMENT.CAPTURE.REFUNDED": if (userId) { const amt = Math.round(Number(res.amount.value) * 100); await credits.grant(userId, -Math.round(amt), "refund", { note: `Refund ${res.id}` }); } break;
      case "BILLING.SUBSCRIPTION.CANCELLED": case "BILLING.SUBSCRIPTION.SUSPENDED": if (userId) await prisma.subscription.updateMany({ where: { userId }, data: { status: body.event_type.endsWith("CANCELLED") ? "cancelled" : "paused" } }); break;
      case "PAYMENT.CAPTURE.DENIED": if (userId) { await prisma.subscription.updateMany({ where: { userId }, data: { status: "past_due" } }); const u = await prisma.user.findUnique({ where: { id: userId } }); if (u) await emailQueue.add("send", { to: u.email, key: "renewalFailed", params: { retryDate: new Date(Date.now() + 2 * 864e5).toDateString() } }); } break;
    }
    return { ok: true }; });
}
