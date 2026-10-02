import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // An alternate cache folder is useful when a sync client locks .next.
  distDir: process.env.OPENREPLY_BUILD_DIR || ".next",
  reactCompiler: true,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
