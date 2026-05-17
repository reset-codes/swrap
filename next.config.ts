import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // NOTE: output: 'standalone' is NOT needed for Vercel deployment.
  // If you need Docker deployment (apps/web/Dockerfile), uncomment:
  // output: 'standalone',

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
