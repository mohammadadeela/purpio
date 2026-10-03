import { z } from "zod";

export const ProjectTypeZ = z.enum(["website", "webapp", "mobile", "image", "video"]);
export type ProjectTypeT = z.infer<typeof ProjectTypeZ>;

export const CreateProjectZ = z.object({
  prompt: z.string().min(4).max(4000),
  type: ProjectTypeZ,
  modelKey: z.string().default("gpt-5"),
  attachments: z.array(z.object({ url: z.string().url(), kind: z.enum(["image", "url", "file"]) })).default([]),
});
export const ChatZ = z.object({ content: z.string().min(1).max(4000), modelKey: z.string().optional(), selector: z.string().optional() });
export const MediaZ = z.object({ kind: z.enum(["image", "video"]), prompt: z.string().min(2), width: z.number().optional(), height: z.number().optional(), durationS: z.number().min(5).max(60).optional(), aspect: z.string().optional(), count: z.number().min(1).max(4).default(1) });
export const DeployZ = z.object({ provider: z.enum(["purpio_subdomain", "hostinger", "zip", "github"]), subdomain: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(), domain: z.string().optional(), versionId: z.string().optional() });
export const SecretZ = z.object({ name: z.string().regex(/^[A-Z0-9_]{2,64}$/), value: z.string().min(1).max(8192), kind: z.enum(["api_key", "env", "deploy_token"]), projectId: z.string().optional() });

/** Base credit estimates per project type before the model multiplier. */
export const BASE_ESTIMATE: Record<ProjectTypeT, number> = { website: 140, webapp: 320, mobile: 360, image: 8, video: 800 };
export const CHAT_EDIT_ESTIMATE = 40;

export type Brief = {
  name: string; subject: string; audience: string; primary_goal: string; pages: string[];
  data: Record<string, string[]>; integrations: Record<string, boolean>; admin: string[];
  tone: string[]; style_refs: string[]; assumptions: string[];
};
export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "step"; file: string; status: "run" | "done" }
  | { type: "preview"; url: string }
  | { type: "done"; creditsUsed: number; versionNumber: number; summary: string }
  | { type: "error"; message: string };
