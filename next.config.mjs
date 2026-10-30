/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["yahoo-finance2"],
  images: { unoptimized: true },
};
export default nextConfig;
