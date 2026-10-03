import { prisma } from "@purpio/db";
import { redis } from "../../api/src/lib/redis.js";
import type { StreamEvent } from "@purpio/shared";
export { prisma, redis };
export const emit = (projectId: string, ev: StreamEvent) => redis.publish(`project:${projectId}`, JSON.stringify(ev));
export async function log(jobId: string, line: string) { await prisma.$executeRaw`UPDATE "BuildJob" SET log = log || ${line + "\n"} WHERE id = ${jobId}`; }
/** Active prompt for a stage: admin override (with A/B) or the shipped default. */
export async function promptFor(stage: string, fallback: string) {
  const rows = await prisma.promptVersion.findMany({ where: { stage, OR: [{ active: true }, { abPct: { gt: 0 } }] } });
  const ab = rows.find((r) => !r.active && r.abPct > 0); if (ab && Math.random() * 100 < ab.abPct) return ab.content;
  return rows.find((r) => r.active)?.content ?? fallback;
}
