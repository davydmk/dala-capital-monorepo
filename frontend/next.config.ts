import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Запросы идут на собственный домен и проксируются в NestJS: так кука сессии
  // остаётся первой стороной и не зависит от настроек CORS и SameSite.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
