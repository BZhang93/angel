import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root: a stray package-lock.json in a parent directory
    // otherwise makes Turbopack guess ~/ and warn on every start.
    root: __dirname,
  },
  experimental: {
    serverActions: {
      // Signed documents are uploaded through a server action. The 1MB default
      // rejects an ordinary countersigned SAFE; 20MB matches the cap the
      // attachment ingest already applies.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
