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
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      // Common Android/Chrome PWA sizes — browsers will scale the provided PNG as needed
      { src: '/wimpyai-logo-render-removebg-preview.png', sizes: '72x72', type: 'image/png' },
      { src: '/wimpyai-logo-render-removebg-preview.png', sizes: '96x96', type: 'image/png' },
      { src: '/wimpyai-logo-render-removebg-preview.png', sizes: '128x128', type: 'image/png' },
      { src: '/wimpyai-logo-render-removebg-preview.png', sizes: '192x192', type: 'image/png' },
      { src: '/wimpyai-logo-render-removebg-preview.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}
