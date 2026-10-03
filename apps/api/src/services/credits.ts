/**
 * Credits ledger. Balance is always the sum of the ledger; holds reserve credits before any model call.
 * Flow: estimate -> hold -> run -> settle(actual) (releases the difference) or release on failure.
 */
import { prisma, type LedgerReason } from "@purpio/db";
import { emailQueue } from "../lib/redis.js";

export async function balance(userId: string) {
  const [agg, holds] = await Promise.all([
    prisma.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } }),
    prisma.creditHold.aggregate({ where: { userId, status: "held" }, _sum: { amount: true } }),
  ]);
  const total = agg._sum.delta ?? 0, held = holds._sum.amount ?? 0;
  return { total, held, available: total - held };
}

export class InsufficientCredits extends Error { constructor(public need: number, public have: number) { super("Not enough credits"); } }

export async function hold(userId: string, amount: number) {
  return prisma.$transaction(async (tx) => {
    // serialize per user so two parallel runs cannot both pass the check
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const agg = await tx.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
    const h = await tx.creditHold.aggregate({ where: { userId, status: "held" }, _sum: { amount: true } });
    const available = (agg._sum.delta ?? 0) - (h._sum.amount ?? 0);
    if (available < amount) throw new InsufficientCredits(amount, available);
    return tx.creditHold.create({ data: { userId, amount } });
  });
}

export async function settle(holdId: string, actual: number, ref: { type: string; id: string; note?: string }) {
  return prisma.$transaction(async (tx) => {
    const h = await tx.creditHold.findUniqueOrThrow({ where: { id: holdId } });
    if (h.status !== "held") return h;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${h.userId}))`;
    const agg = await tx.creditLedger.aggregate({ where: { userId: h.userId }, _sum: { delta: true } });
    const balanceAfter = (agg._sum.delta ?? 0) - actual;
    await tx.creditLedger.create({ data: { userId: h.userId, delta: -actual, balanceAfter, reason: "usage", refType: ref.type, refId: ref.id, note: ref.note } });
    const out = await tx.creditHold.update({ where: { id: holdId }, data: { status: "settled", settledAt: new Date() } });
    await notifyLow(h.userId, balanceAfter);
    return out;
  });
}
export async function release(holdId: string) {
  return prisma.creditHold.updateMany({ where: { id: holdId, status: "held" }, data: { status: "released", settledAt: new Date() } });
}
export async function grant(userId: string, amount: number, reason: LedgerReason, ref?: { type?: string; id?: string; note?: string; expiresAt?: Date }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const agg = await tx.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
    return tx.creditLedger.create({ data: { userId, delta: amount, balanceAfter: (agg._sum.delta ?? 0) + amount, reason, refType: ref?.type, refId: ref?.id, note: ref?.note, expiresAt: ref?.expiresAt } });
  });
}
async function notifyLow(userId: string, bal: number) {
  const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true, user: true } });
  if (!sub) return;
  const pct = bal / Math.max(1, sub.plan.creditsPerPeriod);
  if (bal <= 0) await emailQueue.add("send", { to: sub.user.email, key: "creditsOut", params: {} }, { jobId: `out-${userId}-${sub.currentPeriodStart.getTime()}` });
  else if (pct <= 0.2) await emailQueue.add("send", { to: sub.user.email, key: "creditsLow", params: { left: bal } }, { jobId: `low-${userId}-${sub.currentPeriodStart.getTime()}` });
}

/** Credit cost for a model call from the price table (credits per 1k tokens). */
export async function tokenCost(modelKey: string, tokensIn: number, tokensOut: number) {
  const m = await prisma.model.findUniqueOrThrow({ where: { key: modelKey } });
  return Math.ceil((Number(m.creditsPer1kIn) * tokensIn + Number(m.creditsPer1kOut) * tokensOut) / 1000);
}
export async function estimate(kind: "website" | "webapp" | "mobile" | "image" | "video" | "edit", modelKey: string, opts?: { count?: number; durationS?: number }) {
  const m = await prisma.model.findUniqueOrThrow({ where: { key: modelKey } });
  if (kind === "image") return m.creditsPerImage * (opts?.count ?? 1);
  if (kind === "video") return m.creditsPerVideoS * (opts?.durationS ?? 10);
  const base = { website: 140, webapp: 320, mobile: 360, edit: 40 }[kind];
  const ref = await prisma.model.findUniqueOrThrow({ where: { key: "gpt-5" } });
  const mult = Number(m.creditsPer1kOut) / Number(ref.creditsPer1kOut); // relative to the default model
  return Math.round(base * mult);
}
