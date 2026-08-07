import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WimpyAI',
  description: 'A calm, Claude-style AI chat experience for Wimpy Cooperations.',
  icons: {
    icon: '/wimpyai-logo-render-removebg-preview.png',
    shortcut: '/wimpyai-logo-render-removebg-preview.png',
    apple: '/wimpyai-logo-render-removebg-preview.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
