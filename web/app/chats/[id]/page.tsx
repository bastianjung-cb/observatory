import { notFound } from "next/navigation";
import { getChatInfo, getMessages } from "@/lib/queries/messages";
import { MessageList } from "@/components/message-list";
import { KeyboardHints } from "@/components/keyboard-hints";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const chat = await getChatInfo(id);

  if (!chat) {
    notFound();
  }

  const messages = await getMessages(id);

  return (
    <div className="flex flex-col -mx-6 -mt-6 -mb-6" style={{ height: "calc(100vh - 90px)" }}>
      {/* Fixed header */}
      <div className="shrink-0 bg-background border-b px-6 py-3">
        <h2 className="text-lg font-bold">
          {chat.title || "Untitled Chat"}
        </h2>
        <div className="flex items-center gap-2 mt-0.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{chat.user_name}</span>
          {chat.user_email && (
            <span>({chat.user_email})</span>
          )}
          <span>&middot;</span>
          <span suppressHydrationWarning>{new Date(chat.created_at).toLocaleString()}</span>
          <span>&middot;</span>
          <span>{messages.length} messages</span>
        </div>
        <KeyboardHints shortcuts={[
          { key: "↑↓", action: "Navigate" },
          { key: "→", action: "View workflow" },
          { key: "←", action: "Back to chats" },
          { key: "E", action: "Toggle full text" },
          { key: "W", action: "Open Temporal UI" },
        ]} />
      </div>

      {/* Scrollable messages */}
      <div className="flex-1 overflow-auto px-6 py-3">
        <MessageList messages={messages} chatId={id} />
      </div>
    </div>
  );
}
