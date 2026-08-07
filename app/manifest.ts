import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WimpyAI',
    short_name: 'WimpyAI',
    description: 'A calm Claude-style AI chat experience for Wimpy Cooperations.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f2ece7',
    theme_color: '#b6653d',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
