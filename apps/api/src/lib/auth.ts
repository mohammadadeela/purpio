import { createHash, randomBytes } from "node:crypto";
import admin from "firebase-admin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@purpio/db";
import { env } from "./env.js";
import { emailQueue } from "./redis.js";

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });

const COOKIE = "purpio_session";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Exchange a Firebase ID token for a Purpio session cookie. Creates the user + personal workspace on first sign-in. */
export async function signInWithFirebase(idToken: string, req: FastifyRequest, reply: FastifyReply, referral?: string) {
  const decoded = await admin.auth().verifyIdToken(idToken, true);
  let user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  const isNew = !user;
  if (!user) {
    const referrer = referral ? await prisma.user.findUnique({ where: { referralCode: referral } }) : null;
    user = await prisma.user.create({ data: { firebaseUid: decoded.uid, email: decoded.email!, name: decoded.name ?? decoded.email!.split("@")[0], avatarUrl: decoded.picture, emailVerified: !!decoded.email_verified, referredById: referrer?.id,
      workspaces: { create: { name: "Personal workspace", slug: `ws-${decoded.uid.slice(0, 8).toLowerCase()}` } } } });
    const free = await prisma.plan.findUniqueOrThrow({ where: { key: "free" } });
    await prisma.$transaction([
      prisma.subscription.create({ data: { userId: user.id, planKey: "free", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } }),
      prisma.creditLedger.create({ data: { userId: user.id, delta: free.creditsPerPeriod, balanceAfter: free.creditsPerPeriod, reason: "plan_grant", note: "Free plan" } }),
    ]);
    if (referrer) await prisma.referral.create({ data: { referrerId: referrer.id, referredId: user.id } });
    await emailQueue.add("send", { to: user.email, key: "welcome", params: { name: user.name } });
  } else if (decoded.email_verified && !user.emailVerified) await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });

  const token = randomBytes(32).toString("hex");
  const ua = req.headers["user-agent"] ?? "", ip = req.ip;
  const known = await prisma.session.findFirst({ where: { userId: user.id, userAgent: ua } });
  await prisma.session.create({ data: { userId: user.id, tokenHash: hash(token), userAgent: ua, ip, expiresAt: new Date(Date.now() + 30 * 864e5) } });
  if (!isNew && !known) await emailQueue.add("send", { to: user.email, key: "newDevice", params: { device: ua.slice(0, 60), where: ip } });
  reply.setCookie(COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400, signed: true });
  return { user, isNew };
}

export async function getSession(req: FastifyRequest) {
  const raw = req.cookies[COOKIE]; if (!raw) return null;
  const unsigned = req.unsignCookie(raw); if (!unsigned.valid || !unsigned.value) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: hash(unsigned.value) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || s.user.deletedAt) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return s;
}
export async function signOut(req: FastifyRequest, reply: FastifyReply, everywhere = false) {
  const s = await getSession(req);
  if (s) await prisma.session.deleteMany({ where: everywhere ? { userId: s.userId } : { id: s.id } });
  reply.clearCookie(COOKIE, { path: "/" });
}
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const s = await getSession(req); if (!s) { reply.code(401).send({ error: "Sign in to continue" }); return null; }
  (req as any).user = s.user; return s.user;
}
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const u = await requireUser(req, reply); if (!u) return null;
  if (u.role !== "admin" || !u.twoFaEnabled) { reply.code(403).send({ error: "Admin with 2FA required" }); return null; }
  return u;
}
