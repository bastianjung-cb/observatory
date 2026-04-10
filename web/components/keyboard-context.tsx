"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface Shortcut {
  key: string;
  action: string;
}

const KeyboardContext = createContext<{
  shortcuts: Shortcut[];
  setShortcuts: (s: Shortcut[]) => void;
}>({ shortcuts: [], setShortcuts: () => {} });

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcutsState] = useState<Shortcut[]>([]);
  const setShortcuts = useCallback((s: Shortcut[]) => setShortcutsState(s), []);

  return (
    <KeyboardContext.Provider value={{ shortcuts, setShortcuts }}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboardHints() {
  return useContext(KeyboardContext);
}
