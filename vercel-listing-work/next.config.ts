import type { NextConfig } from 'next';

const storageOrigin = 'https://korea-autoparts-image-studio.kongee7425.chatgpt.site';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{
      source: '/api/listing-work',
      destination: `${storageOrigin}/api/listing-work`,
    }];
  },
};

export default nextConfig;
