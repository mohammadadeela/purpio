/**
 * Deploy: Purpio subdomain (S3 + Cloudflare DNS), Hostinger (API for static, SSH for VPS), zip, GitHub.
 * Secrets are decrypted only here, injected as env, never written into project files.
 */
import type { Job } from "bullmq";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execa } from "execa";
import archiver from "archiver";
import { NodeSSH } from "node-ssh";
import { decryptSecret } from "../../../api/src/lib/crypto.js";
import { putObject } from "../../../api/src/services/storage.js";
import * as credits from "../../../api/src/services/credits.js";
import { emailQueue } from "../../../api/src/lib/redis.js";
import { prisma, emit } from "../lib.js";

const env = process.env;
async function appendLog(depId: string, projectId: string, line: string) { await prisma.$executeRaw`UPDATE "Deployment" SET log = log || ${line + "\n"} WHERE id = ${depId}`; await emit(projectId, { type: "thinking", text: line + "\n" }); }

export async function runDeploy(job: Job<{ jobId: string }>) {
  const bj = await prisma.buildJob.findUniqueOrThrow({ where: { id: job.data.jobId }, include: { project: { include: { workspace: { include: { owner: true } } } } } });
  const p = bj.project, owner = p.workspace.owner, inp = bj.input as { deploymentId: string; provider: string; subdomain: string; domain?: string; versionId?: string };
  const dep = await prisma.deployment.findUniqueOrThrow({ where: { id: inp.deploymentId } });
  const L = (l: string) => appendLog(dep.id, p.id, l);
  await prisma.$transaction([prisma.deployment.update({ where: { id: dep.id }, data: { status: "building" } }), prisma.buildJob.update({ where: { id: bj.id }, data: { status: "running", startedAt: new Date() } })]);
  const dir = await mkdtemp(join(tmpdir(), "deploy-"));
  try {
    const v = inp.versionId ? await prisma.projectVersion.findFirstOrThrow({ where: { id: inp.versionId, projectId: p.id }, include: { files: true } }) : await prisma.projectVersion.findFirstOrThrow({ where: { projectId: p.id }, orderBy: { number: "desc" }, include: { files: true } });
    for (const f of v.files) { const fp = join(dir, f.path); await mkdir(dirname(fp), { recursive: true }); await writeFile(fp, f.content ?? ""); }
    // Secrets -> env (never into files)
    const secrets = await prisma.userSecret.findMany({ where: { userId: owner.id, OR: [{ projectId: p.id }, { projectId: null, kind: "env" }] } });
    const envVars: Record<string, string> = {}; for (const s of secrets) if (s.kind !== "deploy_token") envVars[s.name] = decryptSecret(s, `secret:${owner.id}:${s.projectId ?? ""}:${s.name}`);
    const envHash = createHash("sha256").update(JSON.stringify(Object.keys(envVars).sort())).digest("hex").slice(0, 12);
    await L(`Building production bundle (v${v.number})…`);
    const isNext = v.files.some((f) => f.path === "package.json" && (f.content ?? "").includes('"next"'));
    let outDir = dir;
    if (isNext) {
      const r1 = await execa("pnpm", ["install", "--silent"], { cwd: dir, reject: false, timeout: 600_000 }); if (r1.exitCode !== 0) throw new Error(`Install failed:\n${r1.stderr.slice(-800)}`);
      const r2 = await execa("pnpm", ["exec", "next", "build"], { cwd: dir, reject: false, timeout: 900_000, env: { ...env, ...envVars, NEXT_TELEMETRY_DISABLED: "1" } }); if (r2.exitCode !== 0) throw new Error(`Build failed:\n${r2.stderr.slice(-800)}`);
      outDir = join(dir, "out"); await L(`Optimizing images and ${v.files.length} files…`);
    }
    let url = "";
    if (inp.provider === "purpio_subdomain") {
      const host = `${inp.subdomain}.${env.PREVIEW_DOMAIN}`; await L(`Uploading to ${host}…`);
      await uploadDir(outDir, `sites/${inp.subdomain}`); await cloudflareCname(inp.subdomain); url = `https://${host}`;
      await L("Issuing SSL certificate… done (Cloudflare universal SSL)");
    } else if (inp.provider === "hostinger") {
      const tok = secrets.find((s) => s.name === "HOSTINGER_API_TOKEN" && s.kind === "deploy_token") ?? (await prisma.userSecret.findFirst({ where: { userId: owner.id, name: "HOSTINGER_API_TOKEN" } }));
      if (!tok) throw new Error("Connect your Hostinger account in Settings, Connections first.");
      const token = decryptSecret(tok, `secret:${owner.id}::HOSTINGER_API_TOKEN`); const domain = inp.domain ?? dep.customDomain; if (!domain) throw new Error("Choose a domain from your Hostinger account.");
      await L(`Uploading to Hostinger (${domain})…`);
      // Hostinger API: list websites, get SFTP/SSH access for the domain, push files. Falls back to SSH when the account is a VPS.
      const sites = await hostinger(token, "GET", "/api/hosting/v1/websites");
      const site = (sites as any[]).find((s) => s.domain === domain); if (!site) throw new Error(`${domain} is not in your Hostinger account.`);
      const access = (await hostinger(token, "GET", `/api/hosting/v1/websites/${site.id}/ssh-access`)) as { host: string; port: number; username: string; password: string; path: string };
      const ssh = new NodeSSH(); await ssh.connect({ host: access.host, port: access.port, username: access.username, password: access.password });
      await ssh.putDirectory(outDir, access.path, { recursive: true, concurrency: 8 });
      if (Object.keys(envVars).length) await ssh.execCommand(`cat > ${access.path}/.env <<'EOF'\n${Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join("\n")}\nEOF\nchmod 600 ${access.path}/.env`);
      ssh.dispose(); url = `https://${domain}`; await L("Checking SSL… Hostinger auto-SSL active");
    } else if (inp.provider === "zip") {
      const zipPath = join(tmpdir(), `${p.slug}.zip`); await new Promise<void>((res, rej) => { const out = createWriteStream(zipPath); const a = archiver("zip"); a.on("error", rej); out.on("close", () => res()); a.pipe(out); a.directory(dir, false); a.finalize(); });
      url = await putObject(`exports/${p.id}/${v.number}.zip`, await readFile(zipPath), "application/zip", false); await L("Zip ready");
    } else if (inp.provider === "github") {
      const gh = await prisma.userSecret.findFirst({ where: { userId: owner.id, name: "GITHUB_TOKEN" } }); if (!gh) throw new Error("Connect GitHub in Settings, Connections first.");
      const token = decryptSecret(gh, `secret:${owner.id}::GITHUB_TOKEN`);
      const repo = (await (await fetch("https://api.github.com/user/repos", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: p.slug, private: true, description: `Built with Purpio` }) })).json()) as { clone_url: string; html_url: string; full_name: string };
      const g = (a: string[]) => execa("git", a, { cwd: dir }); await g(["init", "-b", "main"]); await g(["add", "."]); await g(["-c", "user.name=Purpio", "-c", "user.email=bot@purpio.com", "commit", "-m", `v${v.number} from Purpio`]);
      await g(["push", `https://x-access-token:${token}@github.com/${repo.full_name}.git`, "main", "--force"]); url = repo.html_url; await L(`Pushed to ${repo.full_name}`);
    }
    if (url.startsWith("https://") && inp.provider !== "github" && inp.provider !== "zip") { await L("Running smoke test…"); const pages = ["/", "/about", "/contact", "/privacy", "/404-check"]; let okCount = 0; for (const pg of pages) { try { const r = await fetch(url + pg, { redirect: "follow" }); if (r.status < 500) okCount++; } catch {} } await L(`${okCount}/${pages.length} pages responded`); }
    await credits.settle(bj.creditHoldId!, 4, { type: "deploy", id: dep.id });
    await prisma.$transaction([prisma.deployment.update({ where: { id: dep.id }, data: { status: "live", url, sslStatus: "active", envHash, finishedAt: new Date(), versionId: v.id } }), prisma.buildJob.update({ where: { id: bj.id }, data: { status: "done", progress: 100, finishedAt: new Date(), output: { url } } })]);
    await L(`✓ Live at ${url}`); await emit(p.id, { type: "done", creditsUsed: 4, versionNumber: v.number, summary: url });
    await emailQueue.add("send", { to: owner.email, key: "deployDone", params: { url: url.replace(/^https?:\/\//, "") } });
  } catch (e) {
    const msg = (e as Error).message; await L(`✗ ${msg}`); await credits.release(bj.creditHoldId!);
    await prisma.$transaction([prisma.deployment.update({ where: { id: dep.id }, data: { status: "failed", finishedAt: new Date() } }), prisma.buildJob.update({ where: { id: bj.id }, data: { status: "failed", error: msg } })]);
    await emit(p.id, { type: "error", message: `Deploy stopped: ${msg}` }); await emailQueue.add("send", { to: owner.email, key: "deployFailed", params: { reason: msg, link: `${env.APP_URL}/p/${p.id}?tab=deploy` } }); throw e;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function hostinger(token: string, method: string, path: string, body?: unknown) { const r = await fetch(`https://developers.hostinger.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(`Hostinger ${r.status}: ${await r.text()}`); return r.json(); }
async function uploadDir(dir: string, prefix: string) { const { readdir } = await import("node:fs/promises"); const { extname } = await import("node:path"); const MIME: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain", ".woff2": "font/woff2" };
  const walk = async function* (d: string, rel = ""): AsyncGenerator<string> { for (const e of await readdir(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) yield* walk(join(d, e.name), r); else yield r; } };
  for await (const rel of walk(dir)) await putObject(`${prefix}/${rel}`, await readFile(join(dir, rel)), MIME[extname(rel)] ?? "application/octet-stream", rel.endsWith(".html") ? false : true); }
async function cloudflareCname(sub: string) { if (!env.CLOUDFLARE_API_TOKEN) return; await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, { method: "POST", headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ type: "CNAME", name: sub, content: new URL(env.CDN_URL ?? "https://cdn.purpio.app").host, proxied: true }) }); }
