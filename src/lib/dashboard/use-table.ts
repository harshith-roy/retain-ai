import { useEffect, useMemo, useState } from "react";

/** Client-side search, filter and pagination for dashboard tables. */
export function useTable<T>(
  rows: T[],
  opts: { text: (row: T) => string; status?: (row: T) => string; pageSize?: number },
) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const size = opts.pageSize ?? 10;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!q || opts.text(r).toLowerCase().includes(q)) &&
        (status === "all" || opts.status?.(r) === status),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, status]);
  const pages = Math.ceil(filtered.length / size);
  useEffect(() => setPage(0), [query, status, rows.length]);
  return {
    query,
    setQuery,
    status,
    setStatus,
    page,
    setPage,
    pages,
    total: filtered.length,
    rows: filtered.slice(page * size, page * size + size),
  };
}
