"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { KeyboardHints } from "@/components/keyboard-hints";

export function EscapeToHome() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "Escape" || e.key === "ArrowLeft") && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        router.push("/");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return <KeyboardHints shortcuts={[{ key: "←", action: "Back to chats" }]} />;
}
