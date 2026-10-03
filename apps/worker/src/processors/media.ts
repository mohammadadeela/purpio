import type { Job } from "bullmq";
import { MEDIA_PROMPT } from "@purpio/prompts";
import { generateImage, generateVideo } from "../../../api/src/services/models.js";
import { putObject } from "../../../api/src/services/storage.js";
import * as credits from "../../../api/src/services/credits.js";
import { prisma, emit } from "../lib.js";

export async function runMedia(job: Job<{ jobId: string }>) {
  const bj = await prisma.buildJob.findUniqueOrThrow({ where: { id: job.data.jobId }, include: { project: { include: { workspace: { include: { owner: { include: { subscription: true } } } } } } } });
  const p = bj.project, inp = bj.input as { kind: "image" | "video"; prompt: string; width?: number; height?: number; durationS?: number; aspect?: string; count?: number };
  await prisma.buildJob.update({ where: { id: bj.id }, data: { status: "running", startedAt: new Date() } });
  try {
    const brief = (p.brief ?? {}) as any, tokens = (p.tokens ?? {}) as any;
    const prompt = MEDIA_PROMPT({ name: p.name, subject: brief.subject ?? p.prompt, imageDirection: tokens.image_direction ?? "clean, natural light", palette: JSON.stringify(tokens.palette ?? {}), tone: (brief.tone ?? []).join(", "), userPrompt: inp.prompt, video: inp.kind === "video" ? { durationS: inp.durationS ?? 10, aspect: inp.aspect ?? "16:9" } : undefined });
    await emit(p.id, { type: "thinking", text: `Generating ${inp.kind} in your palette…\n` });
    const free = p.workspace.owner.subscription?.planKey === "free"; let used = 0;
    if (inp.kind === "image") {
      for (let i = 0; i < (inp.count ?? 1); i++) {
        await emit(p.id, { type: "step", file: `image ${i + 1}`, status: "run" });
        const png = await generateImage(prompt + (free ? " Small 'purpio' watermark bottom right." : ""), { width: inp.width ?? 1536, height: inp.height ?? 1024 });
        const url = await putObject(`media/${p.id}/${bj.id}-${i}.png`, png, "image/png");
        await prisma.mediaAsset.create({ data: { projectId: p.id, kind: "image", prompt: inp.prompt, modelKey: "gemini-image", url, width: inp.width ?? 1536, height: inp.height ?? 1024 } });
        await emit(p.id, { type: "step", file: `image ${i + 1}`, status: "done" }); used += (await prisma.model.findUniqueOrThrow({ where: { key: "gemini-image" } })).creditsPerImage;
      }
    } else {
      await emit(p.id, { type: "step", file: `video ${inp.durationS ?? 10}s`, status: "run" });
      const mp4 = await generateVideo(prompt, inp.durationS ?? 10, inp.aspect ?? "16:9"); const url = await putObject(`media/${p.id}/${bj.id}.mp4`, mp4, "video/mp4");
      await prisma.mediaAsset.create({ data: { projectId: p.id, kind: "video", prompt: inp.prompt, modelKey: "gemini-video", url, durationS: inp.durationS ?? 10 } });
      await emit(p.id, { type: "step", file: `video ${inp.durationS ?? 10}s`, status: "done" }); used = (await prisma.model.findUniqueOrThrow({ where: { key: "gemini-video" } })).creditsPerVideoS * (inp.durationS ?? 10);
    }
    await credits.settle(bj.creditHoldId!, used, { type: "job", id: bj.id, note: inp.kind });
    await prisma.chatMessage.create({ data: { projectId: p.id, role: "assistant", content: `${inp.kind === "image" ? "Image" : "Video"} ready in the Media tab.`, modelKey: inp.kind === "image" ? "gemini-image" : "gemini-video", creditsUsed: used } });
    await prisma.buildJob.update({ where: { id: bj.id }, data: { status: "done", progress: 100, finishedAt: new Date() } });
    await emit(p.id, { type: "done", creditsUsed: used, versionNumber: 0, summary: "Media ready" });
  } catch (e) { await credits.release(bj.creditHoldId!); await prisma.buildJob.update({ where: { id: bj.id }, data: { status: "failed", error: (e as Error).message } }); await emit(p.id, { type: "error", message: `Generation stopped: ${(e as Error).message}. Credits were not charged.` }); throw e; }
}
