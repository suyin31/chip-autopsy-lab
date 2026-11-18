import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { en } from '@/core/i18n';
import { I18nProvider, LOCALE_INIT_SCRIPT } from '@/ui/i18n';
import './globals.css';

const inter = localFont({
  src: [
    {
      path: './fonts/InterVariable.woff2',
      weight: '100 600',
      style: 'normal',
    },
    {
      path: './fonts/InterVariable-Italic.woff2',
      weight: '100 600',
      style: 'italic',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
});

const geistMono = localFont({
  src: [
    {
      path: './fonts/GeistMono-Variable.woff2',
      weight: '100 600',
      style: 'normal',
    },
  ],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: en['app.title'],
  description: en['app.description'],
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} dark`}
      style={{ colorScheme: 'dark' }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg text-text-primary antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
