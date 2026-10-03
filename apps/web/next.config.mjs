/** @type {import('next').NextConfig} */
export default { reactStrictMode: true, images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async headers() { return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }]; } };
