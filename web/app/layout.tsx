import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SyncButton } from "@/components/sync-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { KeyboardProvider } from "@/components/keyboard-context";
import { KeyboardFooter } from "@/components/keyboard-hints";
import { ExternalLink } from "lucide-react";
import { NavDropdown } from "@/components/nav-dropdown";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Cellbyte Observatory",
  description: "Explore LLM agent workflow steps",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{`(function(){var t=localStorage.getItem('theme');if(t==='light')document.documentElement.classList.remove('dark');else document.documentElement.classList.add('dark')})()`}</Script>
      </head>
      <body className={`${inter.variable} font-sans bg-background text-foreground antialiased`}>
        <KeyboardProvider>
          <div className="h-screen flex flex-col overflow-hidden">
            <header className="relative border-b px-6 py-3 flex items-center justify-between shrink-0 bg-background">
              <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <img src="/logo-black.png" alt="Cellbyte" className="h-6 object-contain dark:hidden" />
                <img src="/logo-white.png" alt="Cellbyte" className="h-6 object-contain hidden dark:block" />
                <h1 className="text-lg font-semibold">Cellbyte Observatory</h1>
              </a>
              {process.env.INSTANCE_NAME && (
                <span className="absolute left-1/2 -translate-x-1/2 text-xs font-medium text-muted-foreground/60 uppercase tracking-widest select-none">
                  {process.env.INSTANCE_NAME}
                </span>
              )}
              <div className="flex items-center gap-3">
                {process.env.APP_URL && (
                  <a
                    href={process.env.APP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                  >
                    Chat now
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <SyncButton />
                <ThemeToggle />
                <NavDropdown />
              </div>
            </header>
            <main className="flex-1 overflow-auto p-6">{children}</main>
            <KeyboardFooter />
          </div>
        </KeyboardProvider>
      </body>
    </html>
  );
}
