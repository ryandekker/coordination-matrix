/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export' removed - incompatible with dynamic routes like /documents/[id]
  // Cloudflare Pages supports Next.js with SSR
  trailingSlash: true,
  reactStrictMode: true,
};

module.exports = nextConfig;
