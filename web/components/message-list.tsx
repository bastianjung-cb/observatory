"use client";

import { useRouter } from "next/navigation";
import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { useKeyboardNav } from "@/components/use-keyboard-nav";

function truncate(text: string | null, max = 500): string | null {
  if (!text) return text;
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

interface Message {
  id: string;
  order: number;
  role: string;
  created_at: string;
  content_preview: string | null;
  has_workflow: boolean;
  cost_usd: number | null;
  workflow_id: string | null;
  run_id: string | null;
}

function formatCost(cost: number | string | null): string | null {
  const n = Number(cost);
  if (!n || isNaN(n) || n === 0) return null;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  USER: "default",
  ASSISTANT: "default",
  SYSTEM: "outline",
};

const roleBadgeClassName: Record<string, string> = {
  ASSISTANT: "bg-[#6B2C91] text-white border-[#6B2C91]",
};

export function MessageList({
  messages,
  chatId,
}: {
  messages: Message[];
  chatId: string;
}) {
  const router = useRouter();
  const [fullText, setFullText] = useState(false);

  const { selectedIndex } = useKeyboardNav({
    itemCount: messages.length,
    storageKey: `messages:${chatId}`,
    onEnter: (index) => {
      const msg = messages[index];
      if (msg?.has_workflow) {
        router.push(`/chats/${chatId}/messages/${msg.id}`);
      }
    },
    onEscape: () => {
      router.push("/");
    },
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setFullText((prev) => !prev);
      }
      if (e.key === "w" || e.key === "W") {
        const msg = messages[selectedIndex];
        if (msg?.workflow_id && msg?.run_id && process.env.TEMPORAL_UI_URL) {
          e.preventDefault();
          window.open(
            `${process.env.TEMPORAL_UI_URL}/namespaces/${process.env.TEMPORAL_NAMESPACE || "default"}/workflows/${msg.workflow_id}/${msg.run_id}/timeline`,
            "_blank"
          );
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [messages, selectedIndex]);

  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = selectedRef.current?.closest("[class*='overflow-auto']");
    if (selectedIndex === 0) {
      container?.scrollTo(0, 0);
    } else if (selectedIndex === messages.length - 1) {
      container?.scrollTo(0, container.scrollHeight);
    } else {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No messages
        </div>
      ) : (
        messages.map((msg, index) => (
          <div
            key={msg.id}
            ref={index === selectedIndex ? selectedRef : undefined}
            className={`group/msg rounded-lg border p-4 cursor-pointer transition-all duration-150 ${
              index === selectedIndex
                ? "row-glow border-transparent"
                : "hover:bg-accent/20"
            }`}
            onClick={() => {
              if (msg.has_workflow) {
                router.push(`/chats/${chatId}/messages/${msg.id}`);
              }
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant={roleBadgeVariant[msg.role] || "outline"}
                className={roleBadgeClassName[msg.role] || ""}
              >
                {msg.role}
              </Badge>
              {msg.has_workflow && (
                <Badge variant="outline" className="text-xs">
                  workflow
                </Badge>
              )}
              {formatCost(msg.cost_usd) && (
                <span className="text-xs font-mono text-muted-foreground">
                  {formatCost(msg.cost_usd)}
                </span>
              )}
              {msg.workflow_id && (
                <div className="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <button
                    title="Copy workflow ID"
                    className="inline-flex items-center justify-center w-6 h-6 rounded border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(msg.workflow_id!);
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                  </button>
                  {process.env.TEMPORAL_UI_URL && (
                    <a
                      title="Open in Temporal UI"
                      href={`${process.env.TEMPORAL_UI_URL}/namespaces/${process.env.TEMPORAL_NAMESPACE || "default"}/workflows/${msg.workflow_id}/${msg.run_id}/timeline`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-6 h-6 rounded border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
              )}
              <span className="text-xs text-muted-foreground ml-auto" suppressHydrationWarning>
                {new Date(msg.created_at).toLocaleTimeString()}
              </span>
            </div>
            <div className="pl-0">
              {msg.content_preview ? (
                <div className="text-sm prose prose-sm prose-neutral max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullText ? msg.content_preview : truncate(msg.content_preview)!}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">(no text content)</p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
