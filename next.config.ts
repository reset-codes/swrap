import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // NOTE: output: 'standalone' is NOT needed for Vercel deployment.
  // If you need Docker deployment (apps/web/Dockerfile), uncomment:
  // output: 'standalone',

  // Exclude Node.js-only packages from webpack bundling.
  // These packages use native Node.js APIs and are not compatible with
  // the Edge runtime or browser environments.
  serverExternalPackages: [
    'firebase-admin',
    '@prisma/client',
    'prisma',
    '@node-rs/argon2',
    '@node-rs/bcrypt',
  ],

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
