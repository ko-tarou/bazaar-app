import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "odneyqtfxvxyrtgzfnvo.supabase.co",
      },
    ],
  },
};

export default nextConfig;
