import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@purpio/db";
import { SecretZ } from "@purpio/shared";
import { requireUser } from "../lib/auth.js";
import { encryptSecret } from "../lib/crypto.js";
import { emailQueue } from "../lib/redis.js";
import { pub } from "./auth.js";

export async function accountRoutes(app: FastifyInstance) {
  app.patch("/account", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const d = z.object({ name: z.string().min(1).max(80).optional(), locale: z.string().max(8).optional(), timezone: z.string().max(64).optional(), defaultModel: z.string().optional(), prefs: z.record(z.any()).optional() }).parse(req.body);
    const nu = await prisma.user.update({ where: { id: u.id }, data: { ...d, prefs: d.prefs ? { ...(u.prefs as object), ...d.prefs } : undefined } }); return { user: pub(nu) }; });

  // Secrets: stored encrypted, returned masked, never returned in full.
  app.get("/secrets", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; return prisma.userSecret.findMany({ where: { userId: u.id }, select: { id: true, name: true, kind: true, last4: true, projectId: true, createdAt: true, rotatedAt: true } }); });
  app.post("/secrets", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const b = SecretZ.parse(req.body);
    const enc = encryptSecret(b.value, `secret:${u.id}:${b.projectId ?? ""}:${b.name}`);
    const existing = await prisma.userSecret.findFirst({ where: { userId: u.id, projectId: b.projectId ?? null, name: b.name } });
    const row = existing ? await prisma.userSecret.update({ where: { id: existing.id }, data: { ...enc, kind: b.kind, rotatedAt: new Date() } }) : await prisma.userSecret.create({ data: { userId: u.id, projectId: b.projectId, name: b.name, kind: b.kind, ...enc } });
    await prisma.auditLog.create({ data: { actorId: u.id, action: "secret.set", targetType: "secret", targetId: row.id, ip: req.ip } });
    return { id: row.id, name: row.name, last4: row.last4, kind: row.kind }; });
  app.delete("/secrets/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; await prisma.userSecret.deleteMany({ where: { id: (req.params as any).id, userId: u.id } }); return { ok: true }; });

  // Connections = named secrets with kind deploy_token
  app.get("/connections", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const rows = await prisma.userSecret.findMany({ where: { userId: u.id, kind: "deploy_token", projectId: null } });
    return ["HOSTINGER_API_TOKEN", "GITHUB_TOKEN", "GOOGLE_DRIVE_TOKEN", "FIREBASE_SERVICE_ACCOUNT"].map((name) => { const r = rows.find((x) => x.name === name); return { name, connected: !!r, last4: r?.last4 ?? null, rotatedAt: r?.rotatedAt ?? r?.createdAt ?? null }; }); });

  app.get("/api-keys", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; return prisma.apiKey.findMany({ where: { userId: u.id, revokedAt: null }, select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, createdAt: true } }); });
  app.post("/api-keys", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const sub = await prisma.subscription.findUnique({ where: { userId: u.id } }); if (sub?.planKey !== "studio") return reply.code(402).send({ error: "API keys are part of the Studio plan", upgrade: true });
    const { name, scopes } = z.object({ name: z.string().min(1).max(60), scopes: z.array(z.enum(["projects:read", "projects:write", "builds:run"])).default(["projects:read"]) }).parse(req.body);
    const raw = `pk_live_${randomBytes(24).toString("base64url")}`; const row = await prisma.apiKey.create({ data: { userId: u.id, name, prefix: raw.slice(0, 12), hashedKey: createHash("sha256").update(raw).digest("hex"), scopes } });
    return { id: row.id, key: raw, note: "Copy it now; it will not be shown again." }; });
  app.delete("/api-keys/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; await prisma.apiKey.updateMany({ where: { id: (req.params as any).id, userId: u.id }, data: { revokedAt: new Date() } }); return { ok: true }; });

  app.get("/team", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const ws = await prisma.workspace.findFirstOrThrow({ where: { ownerId: u.id }, include: { members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } } } });
    const sub = await prisma.subscription.findUnique({ where: { userId: u.id }, include: { plan: true } }); return { workspace: ws, seats: sub?.plan.maxTeamMembers ?? 1 }; });
  app.post("/team/invite", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const { email, role } = z.object({ email: z.string().email(), role: z.enum(["editor", "viewer"]).default("editor") }).parse(req.body);
    const ws = await prisma.workspace.findFirstOrThrow({ where: { ownerId: u.id } }); const sub = await prisma.subscription.findUnique({ where: { userId: u.id }, include: { plan: true } });
    const n = await prisma.workspaceMember.count({ where: { workspaceId: ws.id } }); if (n + 1 >= (sub?.plan.maxTeamMembers ?? 1)) return reply.code(402).send({ error: "No seats left on your plan", upgrade: true });
    const m = await prisma.workspaceMember.create({ data: { workspaceId: ws.id, invitedEmail: email, role } });
    await emailQueue.add("send", { to: email, key: "teamInvite", params: { by: u.name, workspace: ws.name, link: `${process.env.APP_URL}/invite/${m.id}` } }); return { ok: true }; });
  app.post("/team/accept/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const m = await prisma.workspaceMember.findFirst({ where: { id: (req.params as any).id, invitedEmail: u.email } }); if (!m) return reply.code(404).send({ error: "Invite not found" });
    await prisma.workspaceMember.update({ where: { id: m.id }, data: { userId: u.id, acceptedAt: new Date() } }); return { ok: true }; });

  app.get("/notifications", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; return prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 50 }); });
  app.post("/notifications/read", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; await prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } }); return { ok: true }; });
  app.get("/referrals", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const rows = await prisma.referral.findMany({ where: { referrerId: u.id } });
    return { code: u.referralCode, link: `${process.env.APP_URL}/r/${u.referralCode}`, joined: rows.length, rewarded: rows.filter((r) => r.status === "rewarded").length, credits: rows.filter((r) => r.status === "rewarded").reduce((a, r) => a + r.rewardCredits, 0) }; });
  app.post("/account/export", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; await (await import("../lib/redis.js")).billingQueue.add("export", { userId: u.id }); return { ok: true, note: "We will email you a download link." }; });
}
