import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://temp.thunderanticheat.app'),
  title: 'ThunderMail — Temporary email, instantly',
  description:
    'Create a private temporary email address in seconds. No account, no tracking, and automatic expiration.',
  openGraph: {
    title: 'ThunderMail — Temporary email, instantly',
    description:
      'Private temporary email with no account, no tracking, and automatic expiration.',
    type: 'website',
    url: '/',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'ThunderMail temporary email inbox',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ThunderMail — Temporary email, instantly',
    description:
      'Private temporary email with no account, no tracking, and automatic expiration.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Toaster>
          <TooltipProvider>{children}</TooltipProvider>
        </Toaster>
      </body>
    </html>
  );
}
