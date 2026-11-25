import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared config package ships TypeScript source.
  transpilePackages: ["@aevum-kit/aevum", "@pocket-rails/sdk"],
};

export default config;
