import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
