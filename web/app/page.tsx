import { Suspense } from "react";
import { getChats } from "@/lib/queries/chats";
import { ChatTable } from "@/components/chat-table";
import { KeyboardHints } from "@/components/keyboard-hints";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const page = parseInt(params.page || "1", 10);
  const pageSize = 20;

  let chats, total;
  try {
    const result = await getChats(search, page, pageSize);
    chats = result.chats;
    total = result.total;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isEmpty = message.includes("does not exist");
    return (
      <div>
        <h2 className="text-2xl font-bold mb-4">Chats</h2>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium mb-2">
            {isEmpty ? "Database is empty" : "Cannot connect to database"}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            {isEmpty
              ? "No data has been synced yet. Click \"Sync Now\" to pull data from the app and Temporal databases."
              : message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <KeyboardHints shortcuts={[
        { key: "↑↓", action: "Navigate" },
        { key: "→", action: "Open chat" },
      ]} />
      <Suspense fallback={<div>Loading...</div>}>
        <ChatTable
          chats={chats}
          search={search}
          total={total}
          page={page}
          pageSize={pageSize}
        />
      </Suspense>
    </div>
  );
}
