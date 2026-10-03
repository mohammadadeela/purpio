/**
 * The build pipeline: intent -> design -> build -> review -> preview.
 * Streams thinking and per-file steps to the browser; settles credits to the exact token count.
 */
import type { Job } from "bullmq";
import { INTENT_PROMPT, DESIGN_PROMPT, BUILD_PROMPT, REVIEW_PROMPT, BUILD_CHECKLIST, parseFiles, styleSeed } from "@purpio/prompts";
import { complete } from "../../../api/src/services/models.js";
import * as credits from "../../../api/src/services/credits.js";
import { prisma, emit, log, promptFor } from "../lib.js";
import { buildPreview } from "./preview.js";
import { emailQueue } from "../../../api/src/lib/redis.js";

const headline = (t: string) => t.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 140) ?? "";

export async function runBuild(job: Job<{ jobId: string }>) {
  const bj = await prisma.buildJob.findUniqueOrThrow({ where: { id: job.data.jobId }, include: { project: { include: { workspace: { include: { owner: true } } } } } });
  const p = bj.project, owner = p.workspace.owner, input = bj.input as { prompt?: string; instruction?: string; selector?: string; modelKey: string; first: boolean };
  const t0 = Date.now(); let tokensIn = 0, tokensOut = 0, thinking = "";
  await prisma.buildJob.update({ where: { id: bj.id }, data: { status: "running", startedAt: new Date() } });
  const think = (t: string) => { thinking += t; return emit(p.id, { type: "thinking", text: t }); };
  try {
    let brief = p.brief as any, tokens = p.tokens as any, design = (p.settings as any)?.design as string | undefined;
    const cheap = "gpt-5-mini";
    if (input.first || !brief) {
      await think("Reading your idea and writing the brief…\n");
      const r = await complete(cheap, await promptFor("intent", "You produce product briefs as JSON."), INTENT_PROMPT(input.prompt ?? p.prompt, p.type, owner.locale)); tokensIn += r.usage.tokensIn; tokensOut += r.usage.tokensOut;
      brief = JSON.parse(r.text.replace(/```json|```/g, "").trim());
      await think(`Pages: ${brief.pages.join(", ")}. Admin: ${brief.admin.slice(0, 4).join(", ")}…\nAudience: ${brief.audience}.\n`);
      await think("Choosing a look that fits this subject…\n");
      const d = await complete(input.modelKey, await promptFor("design", "You are a design lead."), DESIGN_PROMPT(JSON.stringify(brief), styleSeed(p.id)), (c) => { if (c.includes("\n")) emit(p.id, { type: "thinking", text: "" }); }); tokensIn += d.usage.tokensIn; tokensOut += d.usage.tokensOut;
      tokens = JSON.parse((d.text.match(/```json[^\n]*\n([\s\S]*?)```/)?.[1] ?? "{}").trim()); design = d.text.match(/```md[^\n]*\n([\s\S]*?)```/)?.[1] ?? d.text;
      await think(`Palette ${Object.values(tokens.palette ?? {}).slice(0, 3).join(", ")} · ${tokens.typography?.display ?? "display"} + ${tokens.typography?.text ?? "text"}.\nHero: ${headline(design.split("Hero")[1] ?? "")}\n`);
      await prisma.project.update({ where: { id: p.id }, data: { brief, tokens, name: brief.name?.slice(0, 60) ?? p.name, settings: { ...(p.settings as object), design } } });
    } else await think(`Understanding the change: "${(input.instruction ?? "").slice(0, 100)}"\nOnly the affected files will be regenerated.\n`);

    const last = await prisma.projectVersion.findFirst({ where: { projectId: p.id }, orderBy: { number: "desc" }, include: { files: true } });
    const existing = !input.first && last ? last.files.map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END ===`).join("\n") : undefined;
    await think("Writing the project…\n");
    let buf = "", current: string | null = null;
    const b = await complete(input.modelKey, await promptFor("build", "You are a senior full-stack engineer."), BUILD_PROMPT({ brief: JSON.stringify(brief), tokens: JSON.stringify(tokens), design: design ?? "", projectType: p.type, existingFiles: existing, instruction: input.instruction, selector: input.selector }), (chunk) => {
      buf += chunk; let m: RegExpExecArray | null;
      const re = /=== FILE: (.+?) ===/g; let lastIdx = 0;
      while ((m = re.exec(buf))) { if (m[1] !== current) { if (current) emit(p.id, { type: "step", file: current, status: "done" }); current = m[1]; emit(p.id, { type: "step", file: current, status: "run" }); } lastIdx = m.index; }
      if (buf.length > 20000) buf = buf.slice(lastIdx);
    }, 60000);
    if (current) await emit(p.id, { type: "step", file: current, status: "done" });
    tokensIn += b.usage.tokensIn; tokensOut += b.usage.tokensOut;
    let files = parseFiles(b.text);
    if (existing && last) { const map = new Map(last.files.map((f) => [f.path, f.content ?? ""])); for (const f of files) map.set(f.path, f.content); files = [...map].map(([path, content]) => ({ path, content })); }
    if (!files.length) throw new Error("The build produced no files. Try again or pick another model.");

    // Review stage: build, lint, fix
    await think("Reviewing: build, accessibility, copy, states…\n");
    const pre = await buildPreview(p.id, files, bj.id, true);
    let summary = "";
    if (!pre.ok || input.first) {
      const r = await complete(cheap, await promptFor("review", "You are the release reviewer."), REVIEW_PROMPT(BUILD_CHECKLIST, pre.log.slice(-6000), files.map((f) => `=== FILE: ${f.path} ===\n${f.content.slice(0, 6000)}\n=== END ===`).join("\n")), undefined, 32000); tokensIn += r.usage.tokensIn; tokensOut += r.usage.tokensOut;
      const fixes = parseFiles(r.text); const map = new Map(files.map((f) => [f.path, f.content])); for (const f of fixes) { map.set(f.path, f.content); await emit(p.id, { type: "step", file: `fix ${f.path}`, status: "done" }); }
      files = [...map].map(([path, content]) => ({ path, content }));
      summary = r.text.split("=== SUMMARY ===")[1]?.trim() ?? "";
    }
    const number = (last?.number ?? 0) + 1;
    const version = await prisma.projectVersion.create({ data: { projectId: p.id, number, message: input.first ? "Initial build" : (input.instruction ?? "Edit").slice(0, 80), createdById: owner.id,
      files: { create: files.map((f) => ({ projectId: p.id, path: f.path, content: f.content, language: f.path.split(".").pop(), size: f.content.length })) } } });
    const preview = await buildPreview(p.id, files, bj.id, false);
    if (preview.url) await emit(p.id, { type: "preview", url: preview.url });

    const used = await credits.tokenCost(input.modelKey, tokensIn, tokensOut) + await credits.tokenCost(cheap, 0, 0) + 4; // + preview build
    await credits.settle(bj.creditHoldId!, used, { type: "job", id: bj.id, note: `Build v${number}` });
    const text = summary || (input.first ? `Your ${p.type} is ready in the preview. I assumed ${brief.assumptions?.slice(0, 2).join("; ") ?? "sensible defaults"}; tell me to change any of it.` : "Done. The preview is updated.");
    await prisma.chatMessage.create({ data: { projectId: p.id, role: "assistant", content: text, thinking, modelKey: input.modelKey, creditsUsed: used, tokensIn, tokensOut, durationMs: Date.now() - t0 } });
    await prisma.chatMessage.updateMany({ where: { id: bj.messageId ?? "" }, data: { creditsUsed: 0 } });
    await prisma.project.update({ where: { id: p.id }, data: { status: "ready", previewUrl: preview.url, coverUrl: preview.thumbUrl ?? undefined } });
    await prisma.buildJob.update({ where: { id: bj.id }, data: { status: "done", progress: 100, finishedAt: new Date(), output: { versionId: version.id, used } } });
    await emit(p.id, { type: "done", creditsUsed: used, versionNumber: number, summary: text });
    const seen = await prisma.session.findFirst({ where: { userId: owner.id, lastSeenAt: { gte: new Date(Date.now() - 2 * 60_000) } } });
    if (!seen) await emailQueue.add("send", { to: owner.email, key: "buildDone", params: { project: p.name, link: `${process.env.APP_URL}/p/${p.id}` } });
  } catch (e) {
    const msg = (e as Error).message; await log(bj.id, `ERROR ${msg}`);
    await credits.release(bj.creditHoldId!);
    await prisma.buildJob.update({ where: { id: bj.id }, data: { status: "failed", error: msg, finishedAt: new Date() } });
    await prisma.project.update({ where: { id: p.id }, data: { status: (await prisma.projectVersion.count({ where: { projectId: p.id } })) ? "ready" : "failed" } });
    await emit(p.id, { type: "error", message: `The build stopped: ${msg}. Your credits were not charged.` });
    throw e;
  }
}
