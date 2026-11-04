import type { ReactNode } from "react";
import { CircleAlert, FlaskConical, Inbox, LoaderCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { RANGES, isEmpty, type RangeKey } from "@/lib/dashboard/model";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("animate-rise rounded-xl border bg-surface", className)}>
      {title && (
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-medium">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
      <FlaskConical className="size-3" />
      Demo data
    </span>
  );
}

const tones = {
  violet: "bg-violet/15 text-violet border-violet/25",
  cyan: "bg-cyan/15 text-cyan border-cyan/25",
  success: "bg-success/15 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/25",
  danger: "bg-destructive/15 text-destructive border-destructive/25",
  muted: "bg-muted text-muted-foreground border-border",
} as const;
export type Tone = keyof typeof tones;
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function RangeSelect() {
  const { range, setRange } = useWorkspace();
  return (
    <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
      <SelectTrigger className="h-9 w-40" aria-label="Date range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGES.map((r) => (
          <SelectItem key={r.key} value={r.key}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-64 pl-9"
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  const { setDemo } = useWorkspace();
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-lg border bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <h3 className="mt-4 text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" className="mt-5" onClick={() => setDemo(true)}>
        <FlaskConical />
        Preview with demo data
      </Button>
    </div>
  );
}

/** Wraps a page section with loading, error and empty states for live data. */
export function DataGate({
  children,
  emptyTitle,
  emptyDescription,
  hasRows,
}: {
  children: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  hasRows?: boolean;
}) {
  const { state, error, demo, data } = useWorkspace();
  if (demo) return <>{children}</>;
  if (state === "error")
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm"
      >
        <CircleAlert className="mt-0.5 size-4 text-destructive" />
        <div>
          <p className="font-medium">Live data unavailable</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  if (state === "loading")
    return (
      <div className="space-y-3" aria-label="Loading workspace data">
        <span className="sr-only">
          <LoaderCircle />
        </span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!(hasRows ?? !isEmpty(data)))
    return (
      <div className="rounded-xl border bg-surface">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  return <>{children}</>;
}

export function Pager({
  page,
  pages,
  onPage,
  total,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
      <span>
        {total} {total === 1 ? "record" : "records"}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {page + 1} of {Math.max(pages, 1)}
        </span>
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export const sessionTone = {
  active: "cyan",
  retained: "success",
  cancelled: "muted",
  escalated: "warning",
} as const;
export const subscriptionTone = {
  active: "success",
  trialing: "cyan",
  paused: "violet",
  past_due: "warning",
  cancelled: "muted",
} as const;
export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const dateFmt = (d: Date) =>
  d.getTime() === 0
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const timeAgo = (d: Date, now: Date) => {
  const m = Math.round((now.getTime() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
