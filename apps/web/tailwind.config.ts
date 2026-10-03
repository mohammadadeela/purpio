import type { Config } from "tailwindcss";
export default { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: { colors: { brand: "var(--brand)", ink: "var(--ink)", canvas: "var(--canvas)", surface: "var(--surface)", line: "var(--line)" } } }, plugins: [] } satisfies Config;
