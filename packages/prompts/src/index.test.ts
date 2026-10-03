import { describe, it, expect } from "vitest";
import { parseFiles, BUILD_PROMPT, BUILD_CHECKLIST } from "./index";
describe("prompts", () => {
  it("parses file blocks", () => {
    const t = `=== FILE: a.ts ===\nconst a=1\n=== END ===\n=== FILE: b/c.tsx ===\nexport {}\n=== END ===`;
    expect(parseFiles(t)).toEqual([{ path: "a.ts", content: "const a=1" }, { path: "b/c.tsx", content: "export {}" }]);
  });
  it("build prompt lists every checklist item", () => {
    const p = BUILD_PROMPT({ brief: "{}", tokens: "{}", design: "", projectType: "website" });
    for (const c of BUILD_CHECKLIST) expect(p).toContain(c);
  });
});
