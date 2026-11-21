import type { NextConfig } from 'next';

/**
 * Public agent artifacts must be fetchable by a browser on another origin
 * (MVP Profile 0.3 §3.3, §3.4). The site publishes one manifest, one resolved
 * network definition, the authored HOCON, the peer link map and the runtime
 * module, so every one of them is served with permissive CORS and no caller
 * credentials.
 */
const CORS_HEADERS = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'accept, content-type' },
  { key: 'Access-Control-Max-Age', value: '86400' },
  { key: 'Vary', value: 'Origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      { source: '/agent-manifest.json', headers: CORS_HEADERS },
      { source: '/links.json', headers: CORS_HEADERS },
      { source: '/agents/:path*', headers: CORS_HEADERS },
      { source: '/agent-runtime/:path*', headers: CORS_HEADERS },
    ];
  },
};

export default nextConfig;
