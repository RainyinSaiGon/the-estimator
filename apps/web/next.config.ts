import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  turbopack: { root: path.resolve(process.cwd(), "../..") },
};

export default nextConfig;
