import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@agetbazar/shared"],
  webpack(config) {
    // Resolve @worker/* to services/worker/src/*
    config.resolve.alias = {
      ...config.resolve.alias,
      "@worker": path.resolve(__dirname, "../../services/worker/src"),
    };
    return config;
  },
};

export default nextConfig;
