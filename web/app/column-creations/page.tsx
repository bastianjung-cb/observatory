import { Suspense } from "react";
import { getColumnCreations, type SortKey, type SortDir } from "@/lib/queries/column-creations";
import { ColumnCreationTable } from "@/components/column-creation-table";
import { KeyboardHints } from "@/components/keyboard-hints";

const VALID_SORT_KEYS = new Set(["column_name", "variant", "rows", "status", "cost", "user", "date"]);
const VALID_SORT_DIRS = new Set(["asc", "desc"]);

export default async function ColumnCreationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    fc?: string;
    fu?: string;
    fs?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const columnFilter = params.fc || "";
  const userFilter = params.fu || "";
  const statusFilter = params.fs || "";
  const page = parseInt(params.page || "1", 10);
  const pageSize = 20;
  const sortKey = (VALID_SORT_KEYS.has(params.sort || "") ? params.sort : "date") as SortKey;
  const sortDir = (VALID_SORT_DIRS.has(params.dir || "") ? params.dir : "desc") as SortDir;

  let rows, total;
  try {
    const result = await getColumnCreations(
      { search, columnFilter, userFilter, statusFilter },
      page,
      pageSize,
      sortKey,
      sortDir
    );
    rows = result.rows;
    total = result.total;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isEmpty = message.includes("does not exist");
    return (
      <div>
        <h2 className="text-2xl font-bold mb-4">Column Creations</h2>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium mb-2">
            {isEmpty ? "No data yet" : "Cannot connect to database"}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            {isEmpty ? "No column creation data has been synced yet." : message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <KeyboardHints shortcuts={[
        { key: "\u2191\u2193", action: "Navigate" },
        { key: "\u2192", action: "Open batch" },
        { key: "\u2318S", action: "Sync" },
      ]} />
      <Suspense fallback={<div>Loading...</div>}>
        <ColumnCreationTable
          rows={rows}
          search={search}
          columnFilter={columnFilter}
          userFilter={userFilter}
          statusFilter={statusFilter}
          total={total}
          page={page}
          pageSize={pageSize}
          sortKey={sortKey}
          sortDir={sortDir}
        />
      </Suspense>
    </div>
  );
}
