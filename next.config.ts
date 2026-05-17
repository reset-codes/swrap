import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Standalone output — required for VPS Docker deployment (apps/web/Dockerfile)
  output: 'standalone',

  // Exclude firebase-admin from webpack bundling (Node.js-only, not Edge-compatible)
  serverExternalPackages: ['firebase-admin'],

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Experimental features for Next.js 15
  experimental: {
    // Enable typed routes for better type safety
    typedRoutes: false,
  },
};

export default nextConfig;
