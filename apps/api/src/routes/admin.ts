import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@purpio/db";
import { requireAdmin } from "../lib/auth.js";
import * as credits from "../services/credits.js";
import * as pp from "../services/paypal.js";
import { redis } from "../lib/redis.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => { if (!(await requireAdmin(req, reply))) return reply; });
  const audit = (req: any, action: string, targetType: string, targetId?: string, diff?: unknown) => prisma.auditLog.create({ data: { actorId: req.user.id, action, targetType, targetId, diff: diff as any, ip: req.ip } });

  app.get("/admin/overview", async () => {
    const since = new Date(Date.now() - 30 * 864e5);
    const [rev, users, paying, failed, total, usage] = await Promise.all([
      prisma.payment.aggregate({ where: { status: { in: ["completed", "PAYMENT.CAPTURE.COMPLETED"] }, createdAt: { gte: since } }, _sum: { amountCents: true } }),
      prisma.user.count({ where: { createdAt: { gte: since } } }), prisma.subscription.count({ where: { status: "active", planKey: { not: "free" } } }),
      prisma.buildJob.count({ where: { status: "failed", createdAt: { gte: since } } }), prisma.buildJob.count({ where: { createdAt: { gte: since } } }),
      prisma.chatMessage.aggregate({ where: { createdAt: { gte: since } }, _sum: { creditsUsed: true, tokensIn: true, tokensOut: true } }),
    ]);
    const creditsSpent = usage._sum.creditsUsed ?? 0; const providerCostCents = Math.round(creditsSpent / 2); // credits are priced at 2x cost
    return { revenueCents: rev._sum.amountCents ?? 0, providerCostCents, marginPct: rev._sum.amountCents ? Math.round((1 - providerCostCents / rev._sum.amountCents) * 100) : 0, newUsers: users, payingUsers: paying, failureRatePct: total ? +((failed / total) * 100).toFixed(1) : 0, creditsSpent };
  });
  app.get("/admin/users", async (req) => { const q = (req.query as any).q as string | undefined; const plan = (req.query as any).plan as string | undefined;
    return prisma.user.findMany({ where: { deletedAt: null, ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}), ...(plan ? { subscription: { planKey: plan } } : {}) }, include: { subscription: { include: { plan: true } } }, orderBy: { createdAt: "desc" }, take: 100 }); });
  app.get("/admin/users/:id", async (req) => { const id = (req.params as any).id;
    const [user, bal, ledger, invoices, projects, sessions] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id }, include: { subscription: { include: { plan: true } }, paymentMethods: true } }), credits.balance(id), prisma.creditLedger.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 100 }), prisma.invoice.findMany({ where: { userId: id } }), prisma.project.findMany({ where: { workspace: { ownerId: id } } }), prisma.session.findMany({ where: { userId: id } })]);
    return { user, balance: bal, ledger, invoices, projects, sessions }; });
  app.post("/admin/users/:id/credits", async (req) => { const { amount, note } = z.object({ amount: z.number().int(), note: z.string().min(2) }).parse(req.body); const id = (req.params as any).id;
    const row = await credits.grant(id, amount, "admin", { note }); await audit(req, "credits.grant", "user", id, { amount, note }); return row; });
  app.post("/admin/users/:id/plan", async (req) => { const { planKey } = z.object({ planKey: z.string() }).parse(req.body); const id = (req.params as any).id; const end = new Date(); end.setMonth(end.getMonth() + 1);
    const s = await prisma.subscription.upsert({ where: { userId: id }, update: { planKey, status: "active" }, create: { userId: id, planKey, currentPeriodStart: new Date(), currentPeriodEnd: end } }); await audit(req, "plan.set", "user", id, { planKey }); return s; });
  app.post("/admin/users/:id/suspend", async (req) => { const id = (req.params as any).id; await prisma.$transaction([prisma.user.update({ where: { id }, data: { deletedAt: new Date() } }), prisma.session.deleteMany({ where: { userId: id } })]); await audit(req, "user.suspend", "user", id); return { ok: true }; });
  app.post("/admin/payments/:captureId/refund", async (req) => { const { amountUsd } = z.object({ amountUsd: z.number().optional() }).parse(req.body ?? {}); const r = await pp.refund((req.params as any).captureId, amountUsd); await audit(req, "payment.refund", "payment", (req.params as any).captureId, { amountUsd }); return r; });

  app.get("/admin/plans", async () => ({ plans: await prisma.plan.findMany({ orderBy: { sort: "asc" } }), packs: await prisma.creditPack.findMany({ orderBy: { sort: "asc" } }), coupons: await prisma.coupon.findMany() }));
  app.put("/admin/plans/:key", async (req) => { const d = z.object({ name: z.string().optional(), priceCents: z.number().int().optional(), creditsPerPeriod: z.number().int().optional(), maxProjects: z.number().int().nullable().optional(), maxTeamMembers: z.number().int().optional(), features: z.array(z.string()).optional(), paypalPlanId: z.string().nullable().optional(), active: z.boolean().optional() }).parse(req.body);
    const p = await prisma.plan.update({ where: { key: (req.params as any).key }, data: d }); await redis.del("catalog"); await audit(req, "plan.update", "plan", p.key, d); return p; });
  app.put("/admin/packs/:key", async (req) => { const d = z.object({ name: z.string().optional(), credits: z.number().int().optional(), priceCents: z.number().int().optional(), bonusPct: z.number().int().optional(), active: z.boolean().optional() }).parse(req.body); return prisma.creditPack.upsert({ where: { key: (req.params as any).key }, update: d, create: { key: (req.params as any).key, name: d.name ?? "", credits: d.credits ?? 0, priceCents: d.priceCents ?? 0, bonusPct: d.bonusPct ?? 0 } }); });
  app.put("/admin/coupons/:code", async (req) => { const d = z.object({ pctOff: z.number().int().nullable().optional(), creditsBonus: z.number().int().nullable().optional(), maxUses: z.number().int().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), active: z.boolean().optional() }).parse(req.body); return prisma.coupon.upsert({ where: { code: (req.params as any).code }, update: d, create: { code: (req.params as any).code, ...d } }); });

  app.get("/admin/models", async () => prisma.model.findMany({ orderBy: { sort: "asc" } }));
  /** Edit provider cost or markup; credits recompute so the whole app updates. */
  app.put("/admin/models/:key", async (req) => { const d = z.object({ costPer1kIn: z.number().optional(), costPer1kOut: z.number().optional(), costPerImage: z.number().optional(), costPerVideoS: z.number().optional(), markup: z.number().optional(), enabled: z.boolean().optional(), badge: z.string().nullable().optional(), isDefault: z.boolean().optional(), minPlan: z.string().optional() }).parse(req.body);
    const cur = await prisma.model.findUniqueOrThrow({ where: { key: (req.params as any).key } }); const mk = d.markup ?? Number(cur.markup);
    const n = (v: number | undefined, c: unknown) => v ?? Number(c);
    const data = { ...d, creditsPer1kIn: n(d.costPer1kIn, cur.costPer1kIn) * mk * 100, creditsPer1kOut: n(d.costPer1kOut, cur.costPer1kOut) * mk * 100, creditsPerImage: Math.round(n(d.costPerImage, cur.costPerImage) * mk * 100), creditsPerVideoS: Math.round(n(d.costPerVideoS, cur.costPerVideoS) * mk * 100) };
    if (d.isDefault) await prisma.model.updateMany({ data: { isDefault: false } });
    const m = await prisma.model.update({ where: { key: cur.key }, data }); await audit(req, "model.update", "model", m.key, d); return m; });

  app.get("/admin/prompts", async () => prisma.promptVersion.findMany({ orderBy: [{ stage: "asc" }, { version: "desc" }] }));
  app.post("/admin/prompts", async (req) => { const { stage, content, activate, abPct } = z.object({ stage: z.enum(["intent", "design", "build", "review", "media"]), content: z.string().min(20), activate: z.boolean().default(false), abPct: z.number().min(0).max(100).default(0) }).parse(req.body);
    const last = await prisma.promptVersion.findFirst({ where: { stage }, orderBy: { version: "desc" } });
    if (activate) await prisma.promptVersion.updateMany({ where: { stage }, data: { active: false } });
    const row = await prisma.promptVersion.create({ data: { stage, version: (last?.version ?? 0) + 1, content, active: activate, abPct } }); await redis.del(`prompt:${stage}`); await audit(req, "prompt.create", "prompt", row.id); return row; });

  app.get("/admin/ideas", async () => prisma.ideaCard.findMany({ orderBy: { sort: "asc" } }));
  app.put("/admin/ideas/:key", async (req) => { const d = z.object({ title: z.string(), description: z.string(), icon: z.string(), category: z.string(), promptTemplate: z.string(), creditEstimate: z.number().int(), sort: z.number().int().default(0), active: z.boolean().default(true) }).parse(req.body); return prisma.ideaCard.upsert({ where: { key: (req.params as any).key }, update: d, create: { key: (req.params as any).key, ...d } }); });
  app.get("/admin/jobs", async (req) => prisma.buildJob.findMany({ where: (req.query as any).status ? { status: (req.query as any).status } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { project: { select: { name: true, workspace: { select: { owner: { select: { email: true } } } } } } } }));
  app.post("/admin/jobs/:id/retry", async (req) => { const j = await prisma.buildJob.update({ where: { id: (req.params as any).id }, data: { status: "queued", error: null } }); const { buildQueue, mediaQueue, deployQueue } = await import("../lib/redis.js"); await (j.kind === "deploy" ? deployQueue : j.kind === "image" || j.kind === "video" ? mediaQueue : buildQueue).add("run", { jobId: j.id }, { jobId: `${j.id}-retry-${Date.now()}` }); return j; });
  app.get("/admin/payments", async () => prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { email: true } } } }));
  app.get("/admin/deployments", async () => prisma.deployment.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { project: { select: { name: true } } } }));
  app.post("/admin/deployments/:id/takedown", async (req) => { const d = await prisma.deployment.update({ where: { id: (req.params as any).id }, data: { status: "rolled_back" } }); await audit(req, "deploy.takedown", "deployment", d.id); return d; });
  app.get("/admin/emails", async () => prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }));
  app.get("/admin/audit", async () => prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { email: true } } } }));
  app.get("/admin/flags", async () => prisma.featureFlag.findMany());
  app.put("/admin/flags/:key", async (req) => { const d = z.object({ enabled: z.boolean(), rolloutPct: z.number().int().min(0).max(100).default(0), allowUserIds: z.array(z.string()).default([]) }).parse(req.body); return prisma.featureFlag.upsert({ where: { key: (req.params as any).key }, update: d, create: { key: (req.params as any).key, ...d } }); });
  app.get("/admin/analytics/funnel", async () => { const since = new Date(Date.now() - 30 * 864e5);
    const [signups, built, deployed, paid] = await Promise.all([prisma.user.count({ where: { createdAt: { gte: since } } }), prisma.project.count({ where: { status: "ready", createdAt: { gte: since } } }), prisma.deployment.count({ where: { status: "live", createdAt: { gte: since } } }), prisma.subscription.count({ where: { planKey: { not: "free" }, createdAt: { gte: since } } })]);
    return [{ stage: "Signed up", count: signups }, { stage: "Built a project", count: built }, { stage: "Deployed", count: deployed }, { stage: "Paid", count: paid }]; });
}
