"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useKeyboardNav } from "@/components/use-keyboard-nav";
import { CopyButton } from "@/components/copy-button";

interface Activity {
  activity_id: string;
  activity_type: string;
  status: string;
  attempt: number;
  scheduled_time: string | null;
  started_time: string | null;
  completed_time: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  model_id: string | null;
}

const DEFAULT_WHITELIST = new Set([
  "invokeModel",
  "executeKeywordSearch",
  "executeSemanticSearch",
  "executeDocumentSearch",
  "executeConstrainedWebSearch",
  "executeReadSpecificPages",
  "ensureAndExecBash",
  "ensureAndWriteFile",
  "ensureAndReadFile",
  "ensureAndLoadAttachments",
  "analyzeImage",
  "createArtifactActivity",
  "agentUpdateArtifactActivity",
]);

function jsonPreview(data: Record<string, unknown> | null, maxLen = 80): string {
  if (!data) return "—";
  const str = JSON.stringify(data);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

function formatTokensCompact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function countMatches(text: string, term: string): number {
  if (!term) return 0;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let count = 0;
  let pos = 0;
  while ((pos = lower.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

// Tokenize JSON string into colored spans
function colorizeJson(json: string): { text: string; className: string }[] {
  const tokens: { text: string; className: string }[] = [];
  // Match JSON tokens: strings, numbers, booleans, null, punctuation
  const regex = /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],])|(\s+)/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: json.slice(lastIndex, match.index), className: "" });
    }
    if (match[1] && match[2]) {
      // Key — dark teal
      tokens.push({ text: match[1], className: "text-[#364F6B] dark:text-[#6b99b8]" });
      // Colon
      tokens.push({ text: match[2], className: "text-[#6b7b8d] dark:text-[#6b7b8d]" });
    } else if (match[3]) {
      // String — cyan / cyan
      tokens.push({ text: match[3], className: "text-[#2a9fa6] dark:text-[#5DD8E0]" });
    } else if (match[4]) {
      // Number — hot pink / hot pink
      tokens.push({ text: match[4], className: "text-[#FC5185] dark:text-[#FC5185]" });
    } else if (match[5]) {
      // Boolean — warm amber
      tokens.push({ text: match[5], className: "text-[#FF9760] dark:text-[#FF9760]" });
    } else if (match[6]) {
      // Null — deep amber
      tokens.push({ text: match[6], className: "text-[#FF9760] dark:text-[#FF9760]" });
    } else if (match[7]) {
      // Punctuation
      tokens.push({ text: match[7], className: "text-[#364F6B] dark:text-[#6b99b8]" });
    } else if (match[8]) {
      // Whitespace
      tokens.push({ text: match[8], className: "" });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < json.length) {
    tokens.push({ text: json.slice(lastIndex), className: "" });
  }
  return tokens;
}

function HighlightedJson({
  data,
  search,
  activeMatchIndex,
  matchOffset,
}: {
  data: Record<string, unknown> | null;
  search: string;
  activeMatchIndex: number;
  matchOffset: number;
}) {
  const formatted = useMemo(
    () => (data ? JSON.stringify(data, null, 2) : "null"),
    [data]
  );

  const tokens = useMemo(() => colorizeJson(formatted), [formatted]);

  const activeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex]);

  // No search: render colorized tokens
  if (!search.trim()) {
    return (
      <pre className="text-xs font-json whitespace-pre-wrap">
        {tokens.map((tok, i) => (
          <span key={i} className={tok.className}>{tok.text}</span>
        ))}
      </pre>
    );
  }

  // With search: flatten to plain text, find matches, then re-render with both colors and highlights
  const term = search.trim();
  const termLower = term.toLowerCase();
  const formattedLower = formatted.toLowerCase();

  // Find all match positions
  const matchPositions: { start: number; end: number; matchIndex: number }[] = [];
  let pos = 0;
  let mIdx = 0;
  while ((pos = formattedLower.indexOf(termLower, pos)) !== -1) {
    matchPositions.push({ start: pos, end: pos + term.length, matchIndex: matchOffset + mIdx });
    mIdx++;
    pos += term.length;
  }

  // Build spans by walking through tokens and splitting at match boundaries
  const spans: React.ReactNode[] = [];
  let charPos = 0;
  let matchPtr = 0;
  let spanKey = 0;

  for (const tok of tokens) {
    const tokStart = charPos;
    const tokEnd = charPos + tok.text.length;
    let offset = 0;

    while (offset < tok.text.length) {
      const absPos = tokStart + offset;

      // Find if we're inside a match
      while (matchPtr < matchPositions.length && matchPositions[matchPtr].end <= absPos) {
        matchPtr++;
      }

      const currentMatch = matchPositions.find(
        (m) => m.start < tokEnd && m.end > absPos && absPos >= m.start
      );

      if (currentMatch) {
        // Emit text before match in this token
        const matchStartInTok = Math.max(currentMatch.start - tokStart, offset);
        if (matchStartInTok > offset) {
          spans.push(
            <span key={spanKey++} className={tok.className}>
              {tok.text.slice(offset, matchStartInTok)}
            </span>
          );
        }
        // Emit match portion
        const matchEndInTok = Math.min(currentMatch.end - tokStart, tok.text.length);
        const isActive = currentMatch.matchIndex === activeMatchIndex;
        spans.push(
          <mark
            key={spanKey++}
            ref={isActive ? activeRef : undefined}
            className={`rounded-sm px-0.5 ${
              isActive
                ? "bg-orange-400 text-black ring-2 ring-orange-500"
                : "bg-yellow-200 text-black"
            }`}
          >
            {tok.text.slice(matchStartInTok, matchEndInTok)}
          </mark>
        );
        offset = matchEndInTok;
      } else {
        // No match overlapping — find next match start or end of token
        const nextMatch = matchPositions.find((m) => m.start > absPos && m.start < tokEnd);
        const end = nextMatch ? nextMatch.start - tokStart : tok.text.length;
        spans.push(
          <span key={spanKey++} className={tok.className}>
            {tok.text.slice(offset, end)}
          </span>
        );
        offset = end;
      }
    }
    charPos = tokEnd;
  }

  return (
    <pre className="text-xs font-json whitespace-pre-wrap">{spans}</pre>
  );
}

// --- Prompt View for invokeModel activities ---

interface PromptMessage {
  role: string;
  content: string | PromptContentPart[];
}

interface PromptContentPart {
  type: string;
  text?: string;
  input?: string;
  toolName?: string;
  toolCallId?: string;
  output?: unknown;
  [key: string]: unknown;
}

const roleColors: Record<string, { bg: string; border: string; badge: string }> = {
  system: { bg: "bg-[#f5f5f5] dark:bg-transparent", border: "border-[#364F6B]/20 dark:border-[#6b99b8]/30", badge: "bg-[#364F6B] text-white" },
  user: { bg: "bg-[#3FC1C9]/5 dark:bg-transparent", border: "border-[#3FC1C9]/20 dark:border-[#3FC1C9]/30", badge: "bg-[#3FC1C9] text-white" },
  assistant: { bg: "bg-[#FC5185]/5 dark:bg-transparent", border: "border-[#FC5185]/20 dark:border-[#FC5185]/30", badge: "bg-[#FC5185] text-white" },
  tool: { bg: "bg-[#FF9760]/5 dark:bg-transparent", border: "border-[#FF9760]/20 dark:border-[#FF9760]/30", badge: "bg-[#FF9760] text-white" },
};

function extractTextFromContent(content: string | PromptContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => {
      const raw = p.text!;
      // The text field may itself be a JSON string like {"text": "...", "sources": []}
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && typeof parsed.text === "string") {
          return parsed.text;
        }
      } catch {
        // Not JSON, use as-is
      }
      return raw;
    })
    .join("\n\n");
}

function renderContentPart(part: PromptContentPart, i: number) {
  if (part.type === "text" && part.text) {
    let text = part.text;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && typeof parsed.text === "string") {
        text = parsed.text;
      }
    } catch { /* not JSON */ }
    return (
      <div key={i} className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  }
  if (part.type === "tool-call") {
    return (
      <div key={i} className="mt-2 rounded border border-[#364F6B]/15 dark:border-[#6b99b8]/30 bg-[#364F6B]/3 dark:bg-transparent p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#364F6B]/80 dark:bg-[#6b99b8]/80 text-white">TOOL CALL</span>
          <span className="font-mono text-sm font-medium">{part.toolName}</span>
        </div>
        <pre className="text-xs font-json whitespace-pre-wrap mt-1 text-[#364F6B] dark:text-[#6b99b8]">
          {typeof part.input === "string" ? part.input : JSON.stringify(part.input, null, 2)}
        </pre>
      </div>
    );
  }
  if (part.type === "tool-result") {
    return (
      <div key={i} className="mt-2 rounded border border-[#364F6B]/15 dark:border-[#6b99b8]/30 bg-[#364F6B]/5 dark:bg-transparent p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#364F6B] dark:bg-[#6b99b8] text-white">TOOL RESULT</span>
        </div>
        <pre className="text-xs font-json whitespace-pre-wrap mt-1 text-[#364F6B] dark:text-[#6b99b8] max-h-48 overflow-auto">
          {JSON.stringify(part.output, null, 2)}
        </pre>
      </div>
    );
  }
  return null;
}

function PromptMessageCard({ msg }: { msg: PromptMessage }) {
  const colors = roleColors[msg.role] || roleColors.system;

  const fullText = typeof msg.content === "string"
    ? msg.content
    : JSON.stringify(msg.content, null, 2);

  return (
    <div className={`relative rounded-lg border ${colors.border} ${colors.bg} p-4 group/card`}>
      <CopyButton text={fullText} className="absolute top-3 right-3 opacity-0 group-hover/card:opacity-100 hover:!opacity-100" />
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
          {msg.role.toUpperCase()}
        </span>
      </div>

      {typeof msg.content === "string" ? (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      ) : (
        <div className="space-y-2">
          {msg.content.map((part, i) => renderContentPart(part, i))}
        </div>
      )}
    </div>
  );
}

function PromptView({
  activity,
  onClose,
}: {
  activity: Activity;
  onClose: () => void;
}) {
  const [hideSystem, setHideSystem] = useState(true);
  const [reversed, setReversed] = useState(true);

  const prompt: PromptMessage[] = (activity.input as Record<string, unknown>)?.options
    ? ((activity.input as Record<string, unknown>).options as Record<string, unknown>)?.prompt as PromptMessage[] || []
    : [];

  const displayPrompt = reversed ? [...prompt].reverse() : prompt;

  const systemCount = prompt.filter((m) => m.role === "system").length;

  const responseContent: PromptContentPart[] = (activity.output as Record<string, unknown>)?.content as PromptContentPart[] || [];
  const modelId = (activity.input as Record<string, unknown>)?.modelId as string || "unknown";

  const responseMsg: PromptMessage | null = responseContent.length > 0
    ? { role: "assistant", content: responseContent }
    : null;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== "Escape" && (e.metaKey || e.ctrlKey || e.altKey)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setHideSystem((prev) => !prev);
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setReversed((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold">invokeModel</span>
          <Badge variant="outline">{modelId}</Badge>
          <span className="text-xs text-muted-foreground">
            {prompt.length} prompt messages
            {hideSystem && systemCount > 0 && ` (${systemCount} system collapsed)`}
          </span>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
        <div className="flex flex-col border-r overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 shrink-0">
            <p className="text-xs font-medium text-muted-foreground">
              Input ({prompt.length} messages{hideSystem && systemCount > 0 ? `, ${systemCount} system collapsed` : ""})
            </p>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="space-y-3">
              {displayPrompt.map((msg, i) => {
                if (msg.role === "system" && hideSystem) {
                  const textPreview = extractTextFromContent(msg.content);
                  return (
                    <div
                      key={i}
                      className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
                      onClick={() => setHideSystem(false)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-600 text-white">SYSTEM</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {textPreview ? textPreview.slice(0, 80) + (textPreview.length > 80 ? "…" : "") : "(system prompt)"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">S to expand</span>
                      </div>
                    </div>
                  );
                }
                return <PromptMessageCard key={i} msg={msg} />;
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 shrink-0">
            <p className="text-xs font-medium text-muted-foreground">Response</p>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="space-y-3">
              {responseMsg ? (
                <PromptMessageCard msg={responseMsg} />
              ) : (
                <p className="text-sm text-muted-foreground">No response</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <footer className="shrink-0 border-t bg-background px-6 py-2">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {[
            { key: "S", action: hideSystem ? "Show system" : "Hide system" },
            { key: "R", action: "Reverse order" },
            { key: "←", action: "Close" },
          ].map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded border border-border bg-muted font-mono text-[10px] font-medium shadow-sm">{s.key}</kbd>
              <span>{s.action}</span>
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

interface ChildWorkflow {
  workflow_id: string;
  workflow_name: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
}

type ListItem =
  | { kind: "activity"; data: Activity; originalIndex: number }
  | { kind: "child"; data: ChildWorkflow; originalIndex: number };

export function ActivitySteps({
  activities,
  childWorkflows = [],
  chatId,
  messageId,
  parentWorkflowId,
}: {
  activities: Activity[];
  childWorkflows?: ChildWorkflow[];
  chatId: string;
  messageId: string;
  parentWorkflowId?: string;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState<"json" | "prompt" | null>(null);
  const [reversed, setReversed] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [overlaySearch, setOverlaySearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [searchInput, setSearchInput] = useState(true);
  const [searchOutput, setSearchOutput] = useState(true);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  function updateSearch(value: string) {
    setOverlaySearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setActiveMatch(0);
    }, 150);
  }

  const allTypes = Array.from(
    new Set(activities.map((a) => a.activity_type))
  ).sort();

  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(allTypes.filter((t) => !DEFAULT_WHITELIST.has(t)))
  );
  const [filterBypassed, setFilterBypassed] = useState(false);
  const [invokeOnly, setInvokeOnly] = useState(false);

  const filteredActivities = invokeOnly
    ? activities.filter((a) => a.activity_type === "invokeModel")
    : filterBypassed
    ? activities
    : activities.filter((a) => !hiddenTypes.has(a.activity_type));

  // Build combined list: activities + child workflows
  const listItems: ListItem[] = [
    ...filteredActivities.map((a): ListItem => ({
      kind: "activity",
      data: a,
      originalIndex: activities.indexOf(a),
    })),
    ...childWorkflows.map((c, i): ListItem => ({
      kind: "child",
      data: c,
      originalIndex: filteredActivities.length + i,
    })),
  ];

  const displayItems = reversed ? [...listItems].reverse() : listItems;

  const openOverlay = (index: number, mode: "json" | "prompt") => {
    const item = displayItems[index];
    if (!item || item.kind !== "activity") return;
    const activity = item.data;
    if (expandedId === activity.activity_id && overlayMode === mode) {
      setExpandedId(null);
      setOverlayMode(null);
    } else {
      setExpandedId(activity.activity_id);
      setOverlayMode(mode);
    }
    setOverlaySearch("");
    setDebouncedSearch("");
    setActiveMatch(0);
    setSearchInput(true);
    setSearchOutput(true);
  };

  const closeOverlay = () => {
    setExpandedId(null);
    setOverlayMode(null);
    setOverlaySearch("");
    setDebouncedSearch("");
    setActiveMatch(0);
    setSearchInput(true);
    setSearchOutput(true);
  };

  const { selectedIndex } = useKeyboardNav({
    itemCount: displayItems.length,
    storageKey: `activities:${chatId}:${messageId}`,
    onEscape: () => {
      if (expandedId) {
        closeOverlay();
      } else if (parentWorkflowId) {
        // Go back to parent workflow
        router.push(`/chats/${chatId}/messages/${messageId}?wf=${parentWorkflowId}`);
      } else {
        router.push(`/chats/${chatId}`);
      }
    },
    onEnter: (index) => {
      const item = displayItems[index];
      if (!item) return;
      if (item.kind === "child") {
        // Drill into child workflow
        router.push(`/chats/${chatId}/messages/${messageId}?wf=${item.data.workflow_id}`);
      } else {
        // Enter always opens JSON view for activities
        openOverlay(index, "json");
      }
    },
    onSpace: (index) => {
      const item = displayItems[index];
      if (!item) return;
      if (item.kind === "child") {
        // Space also drills into child
        router.push(`/chats/${chatId}/messages/${messageId}?wf=${item.data.workflow_id}`);
      } else {
        const activity = item.data;
        if (activity.activity_type === "invokeModel") {
          openOverlay(index, "prompt");
        } else {
          openOverlay(index, "json");
        }
      }
    },
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (expandedId) {
        // When overlay is open, F focuses the search box
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          const el = document.getElementById("json-overlay-search") as HTMLInputElement | null;
          el?.focus();
        }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFilterOpen((prev) => !prev);
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setFilterBypassed((prev) => !prev);
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setReversed((prev) => !prev);
      }
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setInvokeOnly((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [expandedId]);

  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = selectedRef.current?.closest("[class*='overflow-auto']");
    if (selectedIndex === 0) {
      container?.scrollTo(0, 0);
    } else if (selectedIndex === displayItems.length - 1) {
      container?.scrollTo(0, container.scrollHeight);
    } else {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          >
            {invokeOnly ? "invokeModel only" : filterBypassed ? "Filter OFF" : `Filter (${displayItems.length}/${activities.length + childWorkflows.length})`}
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Activity Types</p>
                <div className="flex gap-1">
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => setHiddenTypes(new Set())}
                  >
                    All
                  </button>
                  <span className="text-xs text-muted-foreground">/</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => setHiddenTypes(new Set(allTypes))}
                  >
                    None
                  </button>
                </div>
              </div>
              {allTypes.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={!hiddenTypes.has(type)}
                    onCheckedChange={() => toggleType(type)}
                  />
                  {type}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2 py-1">
        {displayItems.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No activities (adjust filter)
          </div>
        ) : (
          displayItems.map((item, index) => {
            if (item.kind === "child") {
              const child = item.data;
              return (
                <div
                  key={`child-${child.workflow_id}`}
                  ref={index === selectedIndex ? selectedRef : undefined}
                  className={`flex items-center gap-3 px-4 py-3 rounded-md border border-dashed cursor-pointer transition-all duration-150 ${
                    index === selectedIndex ? "row-glow" : "border-border hover:bg-accent/50"
                  }`}
                  onClick={() =>
                    router.push(`/chats/${chatId}/messages/${messageId}?wf=${child.workflow_id}`)
                  }
                >
                  <span className="shrink-0 w-8 text-center text-sm font-mono font-semibold text-muted-foreground/70">
                    {item.originalIndex + 1}
                  </span>
                  <Badge className="bg-[#6B2C91] text-white shrink-0">CHILD</Badge>
                  <span className="font-mono text-sm font-bold min-w-0 truncate">
                    {child.workflow_name || child.workflow_id}
                  </span>
                  <Badge
                    variant={child.status === "COMPLETED" ? "secondary" : "destructive"}
                  >
                    {child.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    Enter to drill in →
                  </span>
                </div>
              );
            }

            const activity = item.data;
            return (
              <div
                key={activity.activity_id}
                ref={index === selectedIndex ? selectedRef : undefined}
                className={`rounded-md border border-transparent cursor-pointer transition-all duration-150 ${
                  index === selectedIndex ? "row-glow" : "hover:bg-accent/50"
                }`}
                onClick={() => {
                  if (activity.activity_type === "invokeModel") {
                    openOverlay(index, "prompt");
                  } else {
                    openOverlay(index, "json");
                  }
                }}
              >
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="shrink-0 w-8 text-center text-sm font-mono font-semibold text-muted-foreground/70">
                    {item.originalIndex + 1}
                  </span>
                  <span className="min-w-0 truncate font-mono text-sm font-bold">
                    {activity.activity_type}
                  </span>
                  <Badge
                    variant={
                      activity.status === "COMPLETED" ? "secondary" : "destructive"
                    }
                  >
                    {activity.status}
                  </Badge>
                  {activity.attempt > 1 && (
                    <Badge variant="destructive" className="text-xs">
                      {activity.attempt} attempts
                    </Badge>
                  )}
                  {activity.input_tokens != null && (
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground font-mono">
                      {formatTokensCompact(activity.input_tokens)}↑ {formatTokensCompact(activity.output_tokens || 0)}↓
                    </span>
                  )}
                  {activity.cost_usd != null && Number(activity.cost_usd) > 0 && (
                    <span className="shrink-0 tabular-nums text-xs font-mono font-semibold text-muted-foreground">
                      ${Number(activity.cost_usd).toFixed(4)}
                    </span>
                  )}
                  <div className="ml-auto shrink-0 text-right" suppressHydrationWarning>
                    <span className="tabular-nums text-xs">{formatDuration(activity.duration_ms)}</span>
                    {activity.scheduled_time && (
                      <div className="text-[10px] text-muted-foreground" suppressHydrationWarning>{new Date(activity.scheduled_time).toLocaleTimeString()}</div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-6 px-4 pb-2.5">
                  <p className="truncate font-mono text-[11px] text-muted-foreground/70">
                    <span className="text-muted-foreground/40">in: </span>
                    {jsonPreview(activity.input)}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground/70">
                    <span className="text-muted-foreground/40">out: </span>
                    {jsonPreview(activity.output)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Prompt view overlay for invokeModel */}
      {expandedId && overlayMode === "prompt" && (() => {
        const activity = activities.find((a) => a.activity_id === expandedId);
        if (!activity) return null;
        return <PromptView activity={activity} onClose={closeOverlay} />;
      })()}

      {/* JSON overlay for activity input/output */}
      {expandedId && overlayMode === "json" && (() => {
        const activity = activities.find((a) => a.activity_id === expandedId);
        if (!activity) return null;

        const inputJson = activity.input ? JSON.stringify(activity.input, null, 2) : "null";
        const outputJson = activity.output ? JSON.stringify(activity.output, null, 2) : "null";
        const term = debouncedSearch.trim();
        const inputMatches = term && searchInput ? countMatches(inputJson, term) : 0;
        const outputMatches = term && searchOutput ? countMatches(outputJson, term) : 0;
        const totalMatches = inputMatches + outputMatches;

        return (
          <div
            className="fixed inset-0 z-50 bg-background flex flex-col"
            onClick={closeOverlay}
          >
            <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold">
                  {activity.activity_type}
                </span>
                <Badge
                  variant={
                    activity.status === "COMPLETED" ? "secondary" : "destructive"
                  }
                >
                  {activity.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDuration(activity.duration_ms)}
                </span>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  <Input
                    placeholder="Search JSON..."
                    value={overlaySearch}
                    onChange={(e) => updateSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && totalMatches > 0) {
                        e.preventDefault();
                        if (e.shiftKey) {
                          setActiveMatch((prev) => (prev - 1 + totalMatches) % totalMatches);
                        } else {
                          setActiveMatch((prev) => (prev + 1) % totalMatches);
                        }
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        closeOverlay();
                      }
                    }}
                    className="h-8 w-64 text-xs pr-7"
                    id="json-overlay-search"
                  />
                  {overlaySearch && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => { setOverlaySearch(""); setDebouncedSearch(""); setActiveMatch(0); }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${searchInput ? "bg-[#364F6B] text-white dark:bg-[#6b99b8]" : "bg-muted text-muted-foreground"}`}
                    onClick={() => { setSearchInput((v) => !v); setActiveMatch(0); document.getElementById("json-overlay-search")?.focus(); }}
                  >
                    Input
                  </button>
                  <button
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${searchOutput ? "bg-[#364F6B] text-white dark:bg-[#6b99b8]" : "bg-muted text-muted-foreground"}`}
                    onClick={() => { setSearchOutput((v) => !v); setActiveMatch(0); document.getElementById("json-overlay-search")?.focus(); }}
                  >
                    Output
                  </button>
                </div>
                {term && (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {totalMatches > 0 ? `${activeMatch + 1}/${totalMatches}` : "0 results"}
                  </span>
                )}
              </div>
            </div>
            <div
              className="flex-1 grid grid-cols-2 gap-0 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col border-r overflow-hidden">
                <div className="px-4 py-2 border-b bg-muted/30 shrink-0 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    Input {term && inputMatches > 0 && <span className="text-muted-foreground/60">({inputMatches})</span>}
                  </p>
                  <CopyButton text={activity.input ? JSON.stringify(activity.input, null, 2) : "null"} />
                </div>
                <div className="flex-1 overflow-auto p-4 bg-background">
                  <HighlightedJson data={activity.input} search={searchInput ? debouncedSearch : ""} activeMatchIndex={activeMatch} matchOffset={0} />
                </div>
              </div>
              <div className="flex flex-col overflow-hidden">
                <div className="px-4 py-2 border-b bg-muted/30 shrink-0 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    Output {term && outputMatches > 0 && <span className="text-muted-foreground/60">({outputMatches})</span>}
                  </p>
                  <CopyButton text={activity.output ? JSON.stringify(activity.output, null, 2) : "null"} />
                </div>
                <div className="flex-1 overflow-auto p-4 bg-background">
                  <HighlightedJson data={activity.output} search={searchOutput ? debouncedSearch : ""} activeMatchIndex={activeMatch} matchOffset={inputMatches} />
                </div>
              </div>
            </div>
            <footer className="shrink-0 border-t bg-background px-6 py-2">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {[
                  { key: "F", action: "Search" },
                  { key: "Enter", action: "Next match" },
                  { key: "⇧Enter", action: "Prev match" },
                  { key: "←", action: "Close" },
                ].map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded border border-border bg-muted font-mono text-[10px] font-medium shadow-sm">{s.key}</kbd>
                    <span>{s.action}</span>
                  </span>
                ))}
              </div>
            </footer>
          </div>
        );
      })()}
    </div>
  );
}
