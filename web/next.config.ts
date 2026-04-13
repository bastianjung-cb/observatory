import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (parent of web/)
config({ path: resolve(__dirname, "..", ".env") });

const nextConfig: NextConfig = {
  env: {
    TEMPORAL_UI_URL: process.env.TEMPORAL_UI_URL || "",
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || "default",
  },
};

export default nextConfig;
