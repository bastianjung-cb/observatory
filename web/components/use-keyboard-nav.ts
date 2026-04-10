"use client";

import { useCallback, useEffect, useState } from "react";

interface UseKeyboardNavOptions {
  itemCount: number;
  onEnter?: (index: number) => void;
  onEscape?: () => void;
  onSpace?: (index: number) => void;
  enabled?: boolean;
  storageKey?: string;
}

export function useKeyboardNav({
  itemCount,
  onEnter,
  onEscape,
  onSpace,
  enabled = true,
  storageKey,
}: UseKeyboardNavOptions) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (storageKey && typeof sessionStorage !== "undefined") {
      const saved = sessionStorage.getItem(`nav:${storageKey}`);
      if (saved !== null) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= 0) return n;
      }
    }
    return 0;
  });

  // Clamp to valid range when item count changes
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, itemCount - 1)));
  }, [itemCount]);

  // Persist selected index
  useEffect(() => {
    if (storageKey) {
      sessionStorage.setItem(`nav:${storageKey}`, String(selectedIndex));
    }
  }, [selectedIndex, storageKey]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          e.preventDefault();
          return;
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex(itemCount - 1);
          } else {
            setSelectedIndex((prev) => Math.min(prev + 1, itemCount - 1));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex(0);
          } else {
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case "ArrowRight":
        case "Enter":
          e.preventDefault();
          onEnter?.(selectedIndex);
          break;
        case "ArrowLeft":
        case "Escape":
          e.preventDefault();
          onEscape?.();
          break;
        case " ":
          e.preventDefault();
          onSpace?.(selectedIndex);
          break;
      }
    },
    [enabled, itemCount, onEnter, onEscape, onSpace, selectedIndex]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { selectedIndex, setSelectedIndex };
}
