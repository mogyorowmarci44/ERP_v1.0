import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
