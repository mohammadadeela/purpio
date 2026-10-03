import { describe, it, expect } from "vitest";
describe("credit math", () => {
  // 1 credit = $0.01 to the user; credits = cost × 2 × 100
  const credits = (usd: number) => Math.round(usd * 2 * 100);
  it("prices an image at 8 credits", () => expect(credits(0.04)).toBe(8));
  it("prices a video second at 80 credits", () => expect(credits(0.4)).toBe(80));
  it("clears a 2x margin on Pro", () => { const price = 49, creditValue = 45, providerCost = creditValue / 2; expect(price - providerCost).toBeGreaterThanOrEqual(price / 2); });
});
