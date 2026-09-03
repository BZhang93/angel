import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root: a stray package-lock.json in a parent directory
    // otherwise makes Turbopack guess ~/ and warn on every start.
    root: __dirname,
  },
};

export default nextConfig;
