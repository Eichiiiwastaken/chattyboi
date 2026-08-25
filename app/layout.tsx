import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const ROSE_THEME_COLOR = "#21141e";
const OCEAN_THEME_COLOR = "#0b1924";
const FOREST_THEME_COLOR = "#101b16";
const SUNSET_THEME_COLOR = "#21140f";
const MIDNIGHT_THEME_COLOR = "#131522";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3232"),
  title: "chattyboi",
  description:
    "Self-hosted AI chat with model switching, web search, and editable artifacts.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  maximumScale: 1,
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: LIGHT_THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: DARK_THEME_COLOR },
  ],
};

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var themeColor = html.classList.contains('rose')
      ? '${ROSE_THEME_COLOR}'
      : html.classList.contains('ocean')
        ? '${OCEAN_THEME_COLOR}'
        : html.classList.contains('forest')
          ? '${FOREST_THEME_COLOR}'
          : html.classList.contains('sunset')
            ? '${SUNSET_THEME_COLOR}'
            : html.classList.contains('midnight')
              ? '${MIDNIGHT_THEME_COLOR}'
              : html.classList.contains('dark')
                ? '${DARK_THEME_COLOR}'
                : '${LIGHT_THEME_COLOR}';
    meta.setAttribute('content', themeColor);
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geist.variable} ${geistMono.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
          themes={[
            "light",
            "dark",
            "rose",
            "ocean",
            "forest",
            "sunset",
            "midnight",
          ]}
        >
          <SessionProvider
            basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}
          >
            <TooltipProvider>{children}</TooltipProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
