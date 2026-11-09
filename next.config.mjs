import path from 'node:path';
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pg', 'mysql2', 'mssql', 'better-sqlite3', 'mongodb'],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => { config.resolve.alias.canvas = false; config.resolve.alias.alasql$ = path.resolve('node_modules/alasql/dist/alasql.min.js'); config.resolve.alias.encoding = false; return config; },
};
export default nextConfig;
