import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { en } from '@/core/i18n';
import { I18nProvider, LOCALE_INIT_SCRIPT } from '@/ui/i18n';
import { RouteDirection } from '@/ui/motion/route-direction';
import {
  ACCENT_INIT_SCRIPT,
  THEME_INIT_SCRIPT,
  ThemeController,
} from '@/ui/theme';
import './globals.css';

const instrumentSans = localFont({
  src: [
    {
      path: './fonts/InstrumentSansVariable.woff2',
      weight: '400 700',
      style: 'normal',
    },
    {
      path: './fonts/InstrumentSansVariable-Italic.woff2',
      weight: '400 700',
      style: 'italic',
    },
  ],
  variable: '--font-instrument-sans',
  display: 'swap',
  preload: true,
});

// Display face for the diagnosis line, KPI numbers, and the wordmark: Archivo, a neo-grotesk
// with a high x-height and a low-contrast skeleton that reads as an instrument, not a poster.
const archivo = localFont({
  src: [
    {
      path: './fonts/ArchivoVariable.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-archivo',
  display: 'swap',
  preload: true,
});

// Instrument notes (premium.md §12.4): JetBrains Mono 400, latin, OFL
const jetbrainsMono = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: en['app.title'],
  description: en['app.description'],
};

// theme-color and data-theme are written by THEME_INIT_SCRIPT and ThemeController (premium.md §3.1).
export const viewport: Viewport = {
  colorScheme: 'light dark',
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
      className={`${instrumentSans.variable} ${archivo.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg text-text-primary antialiased">
        <ThemeController />
        <RouteDirection />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
