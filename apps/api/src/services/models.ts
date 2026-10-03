/** One interface over OpenAI, Anthropic and Gemini. Streams text; reports token usage for exact credit settlement. */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../lib/env.js";

export type Usage = { tokensIn: number; tokensOut: number };
export type StreamHandler = (chunk: string) => void;

export async function complete(modelKey: string, system: string, user: string, onChunk?: StreamHandler, maxTokens = 16000): Promise<{ text: string; usage: Usage }> {
  if (modelKey.startsWith("gpt-")) {
    const oa = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const stream = await oa.chat.completions.create({ model: modelKey, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
    let text = "", usage: Usage = { tokensIn: 0, tokensOut: 0 };
    for await (const ev of stream) { const d = ev.choices[0]?.delta?.content ?? ""; if (d) { text += d; onChunk?.(d); } if (ev.usage) usage = { tokensIn: ev.usage.prompt_tokens, tokensOut: ev.usage.completion_tokens }; }
    return { text, usage };
  }
  if (modelKey.startsWith("claude-")) {
    const an = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const stream = an.messages.stream({ model: modelKey, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    let text = "";
    stream.on("text", (t) => { text += t; onChunk?.(t); });
    const final = await stream.finalMessage();
    return { text, usage: { tokensIn: final.usage.input_tokens, tokensOut: final.usage.output_tokens } };
  }
  if (modelKey.startsWith("gemini-")) {
    const g = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
    const m = g.getGenerativeModel({ model: modelKey, systemInstruction: system });
    const res = await m.generateContentStream(user);
    let text = "";
    for await (const c of res.stream) { const t = c.text(); text += t; onChunk?.(t); }
    const r = await res.response;
    return { text, usage: { tokensIn: r.usageMetadata?.promptTokenCount ?? 0, tokensOut: r.usageMetadata?.candidatesTokenCount ?? 0 } };
  }
  throw new Error(`Unknown model ${modelKey}`);
}

/** Gemini image generation. Returns PNG bytes. */
export async function generateImage(prompt: string, size: { width: number; height: number }): Promise<Buffer> {
  const g = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const m = g.getGenerativeModel({ model: "gemini-2.5-flash-image" });
  const res = await m.generateContent([{ text: `${prompt}\nOutput size ${size.width}x${size.height}.` }]);
  const part = res.response.candidates?.[0]?.content.parts.find((p) => "inlineData" in p) as { inlineData?: { data: string } } | undefined;
  if (!part?.inlineData) throw new Error("No image returned");
  return Buffer.from(part.inlineData.data, "base64");
}

/** Gemini (Veo) video generation: long-running operation polled until done. Returns MP4 bytes. */
export async function generateVideo(prompt: string, durationS: number, aspect: string): Promise<Buffer> {
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const start = await fetch(`${base}/models/veo-3.0-generate-001:predictLongRunning?key=${env.GEMINI_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instances: [{ prompt }], parameters: { durationSeconds: durationS, aspectRatio: aspect } }) });
  const op = (await start.json()) as { name: string };
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = (await (await fetch(`${base}/${op.name}?key=${env.GEMINI_API_KEY}`)).json()) as { done?: boolean; response?: { generateVideoResponse?: { generatedSamples?: { video: { uri: string } }[] } } };
    if (st.done) {
      const uri = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video.uri; if (!uri) throw new Error("No video returned");
      return Buffer.from(await (await fetch(`${uri}&key=${env.GEMINI_API_KEY}`)).arrayBuffer());
    }
  }
  throw new Error("Video generation timed out");
}
