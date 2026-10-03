import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticator } from "otplib";
import { prisma } from "@purpio/db";
import { signInWithFirebase, signOut, requireUser, getSession } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/session", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { idToken, referral } = z.object({ idToken: z.string(), referral: z.string().optional() }).parse(req.body);
    const { user, isNew } = await signInWithFirebase(idToken, req, reply, referral);
    return { user: pub(user), isNew };
  });
  app.get("/auth/me", async (req, reply) => { const s = await getSession(req); if (!s) return reply.code(401).send({ error: "Not signed in" }); return { user: pub(s.user) }; });
  app.post("/auth/signout", async (req, reply) => { await signOut(req, reply, (req.body as any)?.everywhere === true); return { ok: true }; });
  app.get("/auth/sessions", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const cur = await getSession(req);
    const rows = await prisma.session.findMany({ where: { userId: u.id }, orderBy: { lastSeenAt: "desc" } });
    return rows.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt, current: s.id === cur?.id })); });
  app.delete("/auth/sessions/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; await prisma.session.deleteMany({ where: { id: (req.params as any).id, userId: u.id } }); return { ok: true }; });
  app.post("/auth/onboarding", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const a = z.object({ builds: z.string(), role: z.string(), source: z.string() }).parse(req.body);
    await prisma.user.update({ where: { id: u.id }, data: { onboardingDone: true, prefs: { ...(u.prefs as object), onboarding: a } } }); return { ok: true }; });
  // 2FA (TOTP)
  app.post("/auth/2fa/setup", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const secret = authenticator.generateSecret(); const enc = encryptSecret(secret, `totp:${u.id}`);
    await prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: Buffer.concat([enc.iv, enc.tag, enc.wrappedKey, enc.ciphertext]).toString("base64") } });
    return { otpauth: authenticator.keyuri(u.email, "Purpio", secret) }; });
  app.post("/auth/2fa/verify", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body); const secret = totpSecret(u);
    if (!secret || !authenticator.check(code, secret)) return reply.code(400).send({ error: "That code is not right. Try the next one." });
    const recovery = Array.from({ length: 10 }, () => Math.random().toString(36).slice(2, 10));
    await prisma.user.update({ where: { id: u.id }, data: { twoFaEnabled: true, prefs: { ...(u.prefs as object), recoveryHashes: recovery.map((r) => Buffer.from(r).toString("base64")) } } });
    return { ok: true, recovery }; });
  app.post("/auth/2fa/disable", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; await prisma.user.update({ where: { id: u.id }, data: { twoFaEnabled: false, totpSecretEnc: null } }); return { ok: true }; });
  app.post("/auth/delete-account", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date(), email: `deleted-${u.id}@purpio.invalid` } }); await signOut(req, reply, true);
    (await import("../lib/redis.js")).emailQueue.add("send", { to: u.email, key: "accountDeleted", params: {} }); return { ok: true }; });
}
function totpSecret(u: { id: string; totpSecretEnc: string | null }) {
  if (!u.totpSecretEnc) return null; const b = Buffer.from(u.totpSecretEnc, "base64");
  return decryptSecret({ iv: b.subarray(0, 12), tag: b.subarray(12, 28), wrappedKey: b.subarray(28, 28 + 60), ciphertext: b.subarray(88) }, `totp:${u.id}`);
}
export const pub = (u: any) => ({ id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl, role: u.role, locale: u.locale, timezone: u.timezone, onboardingDone: u.onboardingDone, emailVerified: u.emailVerified, twoFaEnabled: u.twoFaEnabled, referralCode: u.referralCode, defaultModel: u.defaultModel, prefs: u.prefs });
