/**
 * Preview builder. Writes files to a temp dir, installs, builds a static export, uploads to S3/CDN under /previews/<project>/<hash>/.
 * `check` mode only runs typecheck + build to feed the review stage. Swap the local build for a remote sandbox (e.g. Fly machines, E2B) at scale.
 */
import { mkdtemp, writeFile, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { createHash } from "node:crypto";
import { execa } from "execa";
import { putObject } from "../../../api/src/services/storage.js";
import { log } from "../lib.js";

const MIME: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".woff2": "font/woff2" };

export async function buildPreview(projectId: string, files: { path: string; content: string }[], jobId: string, check: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "purpio-"));
  try {
    for (const f of files) { const fp = join(dir, f.path); await mkdir(dirname(fp), { recursive: true }); await writeFile(fp, f.content); }
    const isNext = files.some((f) => f.path === "package.json" && f.content.includes('"next"'));
    let out = "", ok = true;
    if (isNext) {
      const run = async (cmd: string, args: string[]) => { const r = await execa(cmd, args, { cwd: dir, reject: false, timeout: 10 * 60_000, env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" } }); out += `$ ${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}\n`; if (r.exitCode !== 0) ok = false; return r.exitCode === 0; };
      await run("pnpm", ["install", "--prefer-offline", "--silent"]);
      if (ok) await run("pnpm", ["exec", "tsc", "--noEmit"]);
      if (ok) await run("pnpm", ["exec", "next", "build"]);
      await log(jobId, out.slice(-4000));
      if (check || !ok) return { ok, log: out, url: null, thumbUrl: null };
      const outDir = join(dir, "out"); const hash = createHash("sha1").update(files.map((f) => f.path + f.content).join("\0")).digest("hex").slice(0, 10);
      const base = `previews/${projectId}/${hash}`; let index: string | null = null;
      for await (const rel of walk(outDir)) { const url = await putObject(`${base}/${rel}`, await readFile(join(outDir, rel)), MIME[extname(rel)] ?? "application/octet-stream"); if (rel === "index.html") index = url; }
      return { ok: true, log: out, url: index?.replace(/\/index\.html$/, "/") ?? null, thumbUrl: null };
    }
    // Static site or single HTML: upload as-is
    if (check) return { ok: files.some((f) => f.path.endsWith("index.html")), log: "static", url: null, thumbUrl: null };
    const hash = createHash("sha1").update(files.map((f) => f.path + f.content).join("\0")).digest("hex").slice(0, 10); const base = `previews/${projectId}/${hash}`; let index: string | null = null;
    for (const f of files) { const url = await putObject(`${base}/${f.path}`, f.content, MIME[extname(f.path)] ?? "text/plain"); if (f.path === "index.html") index = url; }
    return { ok: true, log: "static", url: index?.replace(/\/index\.html$/, "/") ?? null, thumbUrl: null };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function* walk(dir: string, rel = ""): AsyncGenerator<string> { for (const e of await readdir(dir, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) yield* walk(join(dir, e.name), r); else yield r; } }
