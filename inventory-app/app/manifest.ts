import type { MetadataRoute } from 'next';

import { APP_NAME } from '@/lib/app-config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    display: 'standalone',
    start_url: '/dashboard',
    icons: [
      {
        src: '/brand/logo-real-mark.png',
        sizes: 'any',
        type: 'image/png',
      },
    ],
  };
}
