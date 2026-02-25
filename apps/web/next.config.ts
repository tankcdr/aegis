import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow cross-origin requests to api.trstlyr.ai in dev
  async rewrites() {
    return process.env.NODE_ENV === 'development'
      ? [
          {
            source: '/api/:path*',
            destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/:path*`,
          },
        ]
      : [];
  },
};

export default nextConfig;
