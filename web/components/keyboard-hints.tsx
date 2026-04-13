"use client";

import { useEffect, useRef } from "react";
import { useKeyboardHints } from "@/components/keyboard-context";

interface Shortcut {
  key: string;
  action: string;
}

// Drop this into a page to register shortcuts for the sticky footer
export function KeyboardHints({ shortcuts }: { shortcuts: Shortcut[] }) {
  const { setShortcuts } = useKeyboardHints();
  const prevRef = useRef<string>("");

  useEffect(() => {
    const serialized = JSON.stringify(shortcuts);
    if (serialized !== prevRef.current) {
      prevRef.current = serialized;
      setShortcuts(shortcuts);
    }
  }, [shortcuts, setShortcuts]);

  return null;
}

// The actual sticky footer rendered in the layout
export function KeyboardFooter() {
  const { shortcuts } = useKeyboardHints();

  if (shortcuts.length === 0) return null;

  return (
    <footer className="sticky bottom-0 border-t bg-background/95 backdrop-blur-sm px-6 py-2 z-40">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {shortcuts.map((s) => (
          <span key={s.key + s.action} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded border border-border bg-muted font-mono text-[10px] font-medium shadow-sm">
              {s.key}
            </kbd>
            <span>{s.action}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
