import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SyncButton } from "@/components/sync-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { KeyboardProvider } from "@/components/keyboard-context";
import { KeyboardFooter } from "@/components/keyboard-hints";
import { Settings } from "lucide-react";

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
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans bg-background text-foreground antialiased`}>
        <KeyboardProvider>
          <div className="h-screen flex flex-col overflow-hidden">
            <header className="border-b px-6 py-3 flex items-center justify-between shrink-0 bg-background">
              <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <img src="/logo-black.png" alt="Cellbyte" className="h-6 w-6 dark:hidden" />
                <img src="/logo-white.png" alt="Cellbyte" className="h-6 w-6 hidden dark:block" />
                <h1 className="text-lg font-semibold">Cellbyte Observatory</h1>
              </a>
              <div className="flex items-center gap-3">
                <SyncButton />
                <ThemeToggle />
                <a href="/settings" className="text-muted-foreground hover:text-foreground transition-colors" title="Settings">
                  <Settings className="h-4 w-4" />
                </a>
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
