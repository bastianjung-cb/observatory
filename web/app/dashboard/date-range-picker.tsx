"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "4w", days: 28 },
  { label: "8w", days: 56 },
  { label: "3m", days: 90 },
];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateStr(d);
}

export function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const fromDate = parseLocal(from);
  const toDate = parseLocal(to);

  function navigate(f: string, t: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to", t);
    router.push(`/dashboard?${params.toString()}`);
  }

  function handlePreset(days: number) {
    navigate(daysAgo(days), toDateStr(new Date()));
  }

  function handleApply() {
    if (range?.from && range?.to) {
      navigate(toDateStr(range.from), toDateStr(range.to));
    }
    setOpen(false);
  }

  function handleOpen(v: boolean) {
    setOpen(v);
    if (v) {
      // Start fresh — user picks both dates
      setRange(undefined);
    }
  }

  const today = toDateStr(new Date());
  const activePreset = PRESETS.find((p) => from === daysAgo(p.days) && to === today);
  const hasValidRange = !!(range?.from && range?.to);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => handlePreset(p.days)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              activePreset?.days === p.days
                ? "bg-[#364F6B] text-white dark:bg-[#6b99b8]"
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger
          className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
          </svg>
          {format(fromDate, "MMM d")} – {format(toDate, "MMM d, yyyy")}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            defaultMonth={fromDate}
            selected={range}
            onSelect={setRange}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
          <div className="flex items-center justify-between border-t px-4 py-2">
            <p className="text-xs text-muted-foreground">
              {range?.from && range?.to
                ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
                : range?.from
                ? `${format(range.from, "MMM d")} – select end date`
                : "Select start and end date"}
            </p>
            <Button size="sm" disabled={!hasValidRange} onClick={handleApply}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
