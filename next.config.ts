import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  distDir: process.env.NEXT_BUILD_DIR || '.next',
};

export default config;
