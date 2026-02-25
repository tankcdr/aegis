import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'trstlyr.ai — Trust scores for the agent internet',
  description:
    'Before you install a skill, execute code, or delegate to another agent — ask first. Aegis aggregates GitHub, ERC-8004, ClawHub, and on-chain signals into a single verifiable trust score.',
  openGraph: {
    title: 'trstlyr.ai',
    description: 'Trust scores for the agent internet',
    url: 'https://trstlyr.ai',
    siteName: 'trstlyr.ai',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'trstlyr.ai — Trust scores for the agent internet',
    description: 'Before you install, execute, or delegate — ask Aegis first.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0f] antialiased">{children}</body>
    </html>
  );
}
