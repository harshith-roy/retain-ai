import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pager, SearchBox } from "./ui";
import type { useTable } from "@/lib/dashboard/use-table";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  table,
  columns,
  search,
  statuses,
}: {
  table: ReturnType<typeof useTable<T>>;
  columns: Column<T>[];
  search: string;
  statuses?: { value: string; label: string }[];
}) {
  return (
    <div className="animate-rise overflow-hidden rounded-xl border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <SearchBox value={table.query} onChange={table.setQuery} placeholder={search} />
        {statuses && (
          <Select value={table.status} onValueChange={table.setStatus}>
            <SelectTrigger className="h-9 w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.length ? (
            table.rows.map((r) => (
              <TableRow key={r.id}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-muted-foreground"
              >
                No records match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Pager page={table.page} pages={table.pages} onPage={table.setPage} total={table.total} />
    </div>
  );
}
