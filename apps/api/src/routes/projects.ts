import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@purpio/db";
import { CreateProjectZ, ChatZ, MediaZ, DeployZ } from "@purpio/shared";
import { requireUser } from "../lib/auth.js";
import { buildQueue, mediaQueue, deployQueue, redis } from "../lib/redis.js";
import * as credits from "../services/credits.js";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
async function own(userId: string, projectId: string) {
  return prisma.project.findFirst({ where: { id: projectId, deletedAt: null, workspace: { OR: [{ ownerId: userId }, { members: { some: { userId, acceptedAt: { not: null } } } }] } } });
}
async function planLimits(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
  return sub?.plan ?? (await prisma.plan.findUniqueOrThrow({ where: { key: "free" } }));
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    return prisma.project.findMany({ where: { deletedAt: null, workspace: { OR: [{ ownerId: u.id }, { members: { some: { userId: u.id } } }] } }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], select: { id: true, name: true, type: true, status: true, coverUrl: true, pinned: true, previewUrl: true, updatedAt: true, lastOpenedAt: true } }); });

  app.post("/projects", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return;
    const body = CreateProjectZ.parse(req.body);
    const plan = await planLimits(u.id); const ws = await prisma.workspace.findFirstOrThrow({ where: { ownerId: u.id } });
    if (plan.maxProjects) { const n = await prisma.project.count({ where: { workspaceId: ws.id, deletedAt: null } }); if (n >= plan.maxProjects) return reply.code(402).send({ error: `Your plan allows ${plan.maxProjects} projects. Upgrade to add more.`, upgrade: true }); }
    const model = await prisma.model.findUnique({ where: { key: body.modelKey } }); if (!model?.enabled) return reply.code(400).send({ error: "That model is not available" });
    if (model.minPlan === "pro" && !["pro", "studio"].includes(plan.key)) return reply.code(402).send({ error: `${model.label} is available on Pro and Studio`, upgrade: true });
    const kind = body.type === "image" || body.type === "video" ? body.type : body.type;
    const est = await credits.estimate(kind, body.type === "image" ? "gemini-image" : body.type === "video" ? "gemini-video" : body.modelKey);
    let hold; try { hold = await credits.hold(u.id, est); } catch (e) { if (e instanceof credits.InsufficientCredits) return reply.code(402).send({ error: "Not enough credits", need: e.need, have: e.have, topup: true }); throw e; }
    const name = body.prompt.split(/[,.]/)[0].replace(/^(a|an|the)\s+/i, "").slice(0, 40);
    const project = await prisma.project.create({ data: { workspaceId: ws.id, name: name[0].toUpperCase() + name.slice(1), slug: `${slug(name)}-${Date.now().toString(36)}`, type: body.type, status: "building", prompt: body.prompt,
      messages: { create: { userId: u.id, role: "user", content: body.prompt, attachments: body.attachments, modelKey: body.modelKey } } }, include: { messages: true } });
    const job = await prisma.buildJob.create({ data: { projectId: project.id, messageId: project.messages[0].id, kind: body.type === "image" || body.type === "video" ? body.type : "plan", input: { prompt: body.prompt, modelKey: body.modelKey, first: true }, creditHoldId: hold.id } });
    await (body.type === "image" || body.type === "video" ? mediaQueue : buildQueue).add("run", { jobId: job.id }, { jobId: job.id });
    return { project: { id: project.id, name: project.name }, jobId: job.id, estimate: est }; });

  app.get("/projects/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    prisma.project.update({ where: { id: p.id }, data: { lastOpenedAt: new Date() } }).catch(() => {});
    const [messages, versions, media, deployments, jobs] = await Promise.all([
      prisma.chatMessage.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" } }),
      prisma.projectVersion.findMany({ where: { projectId: p.id }, orderBy: { number: "desc" } }),
      prisma.mediaAsset.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } }),
      prisma.deployment.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.buildJob.findMany({ where: { projectId: p.id, status: { in: ["queued", "running"] } } }),
    ]);
    return { project: p, messages, versions, media, deployments, activeJobs: jobs }; });

  app.patch("/projects/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const d = z.object({ name: z.string().min(1).max(60).optional(), pinned: z.boolean().optional(), settings: z.record(z.any()).optional() }).parse(req.body);
    return prisma.project.update({ where: { id: p.id }, data: d }); });
  app.delete("/projects/:id", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    await prisma.project.update({ where: { id: p.id }, data: { deletedAt: new Date() } }); return { ok: true }; });
  app.post("/projects/:id/duplicate", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const c = await prisma.project.create({ data: { workspaceId: p.workspaceId, name: `${p.name} copy`, slug: `${p.slug}-copy-${Date.now().toString(36)}`, type: p.type, prompt: p.prompt, brief: p.brief ?? undefined, tokens: p.tokens ?? undefined, status: p.status } });
    const v = await prisma.projectVersion.findFirst({ where: { projectId: p.id }, orderBy: { number: "desc" }, include: { files: true } });
    if (v) await prisma.projectVersion.create({ data: { projectId: c.id, number: 1, message: "Duplicated", files: { create: v.files.map((f) => ({ projectId: c.id, path: f.path, content: f.content, blobUrl: f.blobUrl, language: f.language, size: f.size })) } } });
    return { id: c.id }; });

  /** Chat edit: holds credits, queues an incremental build. */
  app.post("/projects/:id/chat", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const b = ChatZ.parse(req.body); const modelKey = b.modelKey ?? u.defaultModel;
    const est = await credits.estimate("edit", modelKey);
    let hold; try { hold = await credits.hold(u.id, est); } catch (e) { if (e instanceof credits.InsufficientCredits) return reply.code(402).send({ error: "Not enough credits", need: e.need, have: e.have, topup: true }); throw e; }
    const msg = await prisma.chatMessage.create({ data: { projectId: p.id, userId: u.id, role: "user", content: b.content, modelKey } });
    const job = await prisma.buildJob.create({ data: { projectId: p.id, messageId: msg.id, kind: "code", input: { instruction: b.content, selector: b.selector, modelKey, first: false }, creditHoldId: hold.id } });
    await buildQueue.add("run", { jobId: job.id }, { jobId: job.id }); return { jobId: job.id, estimate: est }; });

  app.post("/projects/:id/media", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const b = MediaZ.parse(req.body); const plan = await planLimits(u.id);
    if (b.kind === "video" && (b.durationS ?? 10) > 15 && plan.key !== "studio") return reply.code(402).send({ error: "Videos over 15 s need the Studio plan", upgrade: true });
    const est = await credits.estimate(b.kind, b.kind === "image" ? "gemini-image" : "gemini-video", { count: b.count, durationS: b.durationS });
    let hold; try { hold = await credits.hold(u.id, est); } catch (e) { if (e instanceof credits.InsufficientCredits) return reply.code(402).send({ error: "Not enough credits", need: e.need, have: e.have, topup: true }); throw e; }
    const job = await prisma.buildJob.create({ data: { projectId: p.id, kind: b.kind, input: b, creditHoldId: hold.id } });
    await mediaQueue.add("run", { jobId: job.id }, { jobId: job.id }); return { jobId: job.id, estimate: est }; });

  app.get("/projects/:id/files", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const vId = (req.query as any).versionId; const v = vId ? await prisma.projectVersion.findFirst({ where: { id: vId, projectId: p.id } }) : await prisma.projectVersion.findFirst({ where: { projectId: p.id }, orderBy: { number: "desc" } });
    if (!v) return { version: null, files: [] };
    return { version: v, files: await prisma.projectFile.findMany({ where: { versionId: v.id }, select: { path: true, language: true, size: true, content: (req.query as any).full === "1" } }) }; });
  app.put("/projects/:id/files", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(req.body);
    const v = await prisma.projectVersion.findFirstOrThrow({ where: { projectId: p.id }, orderBy: { number: "desc" } });
    await prisma.projectFile.upsert({ where: { versionId_path: { versionId: v.id, path } }, update: { content, size: content.length }, create: { projectId: p.id, versionId: v.id, path, content, size: content.length } });
    await redis.publish(`project:${p.id}`, JSON.stringify({ type: "preview", url: p.previewUrl })); return { ok: true }; });
  app.post("/projects/:id/versions/:n/restore", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const src = await prisma.projectVersion.findFirstOrThrow({ where: { projectId: p.id, number: Number((req.params as any).n) }, include: { files: true } });
    const last = await prisma.projectVersion.findFirstOrThrow({ where: { projectId: p.id }, orderBy: { number: "desc" } });
    const v = await prisma.projectVersion.create({ data: { projectId: p.id, number: last.number + 1, message: `Restored v${src.number}`, createdById: u.id, files: { create: src.files.map((f) => ({ projectId: p.id, path: f.path, content: f.content, blobUrl: f.blobUrl, language: f.language, size: f.size })) } } });
    await buildQueue.add("preview", { projectId: p.id, versionId: v.id }); return { version: v }; });

  app.post("/projects/:id/deploy", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const p = await own(u.id, (req.params as any).id); if (!p) return reply.code(404).send({ error: "Project not found" });
    const b = DeployZ.parse(req.body); const plan = await planLimits(u.id);
    if ((b.provider === "hostinger" || b.domain) && !["pro", "studio"].includes(plan.key)) return reply.code(402).send({ error: "Deploying to your own hosting or domain needs Pro", upgrade: true });
    if (!u.emailVerified) return reply.code(403).send({ error: "Verify your email before deploying" });
    let hold; try { hold = await credits.hold(u.id, 4); } catch (e) { if (e instanceof credits.InsufficientCredits) return reply.code(402).send({ error: "Not enough credits", need: 4, have: e.have, topup: true }); throw e; }
    const dep = await prisma.deployment.create({ data: { projectId: p.id, provider: b.provider, versionId: b.versionId, customDomain: b.domain, createdById: u.id } });
    const job = await prisma.buildJob.create({ data: { projectId: p.id, kind: "deploy", input: { deploymentId: dep.id, subdomain: b.subdomain ?? p.slug, ...b }, creditHoldId: hold.id } });
    await deployQueue.add("run", { jobId: job.id }, { jobId: job.id }); return { deploymentId: dep.id, jobId: job.id }; });

  /** Live events for a project (thinking, steps, preview, done) over WebSocket via Redis pub/sub. */
  app.get("/projects/:id/events", { websocket: true }, async (socket, req) => {
    const s = await (await import("../lib/auth.js")).getSession(req); const p = s && (await own(s.userId, (req.params as any).id)); if (!p) { socket.close(4401, "unauthorized"); return; }
    const sub = redis.duplicate(); await sub.subscribe(`project:${p.id}`);
    sub.on("message", (_c, m) => socket.send(m)); socket.on("close", () => { sub.unsubscribe(); sub.quit(); });
  });

  app.get("/ideas", async () => prisma.ideaCard.findMany({ where: { active: true }, orderBy: { sort: "asc" } }));
  app.get("/templates", async () => prisma.template.findMany({ orderBy: [{ featured: "desc" }, { sort: "asc" }] }));
  app.get("/models", async (req, reply) => { const u = await requireUser(req, reply); if (!u) return; const plan = await planLimits(u.id);
    const ms = await prisma.model.findMany({ where: { enabled: true }, orderBy: { sort: "asc" } }); const ref = ms.find((m) => m.key === "gpt-5")!;
    return ms.map((m) => ({ key: m.key, label: m.label, badge: m.badge, description: m.description, multiplier: m.creditsPerImage || m.creditsPerVideoS ? null : Number((Number(m.creditsPer1kOut) / Number(ref.creditsPer1kOut)).toFixed(2)), creditsPerImage: m.creditsPerImage, creditsPerVideoS: m.creditsPerVideoS, locked: m.minPlan === "pro" && !["pro", "studio"].includes(plan.key) })); });
}
