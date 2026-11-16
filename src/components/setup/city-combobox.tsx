"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";

export type CityOption = {
  osmRef: string;
  name: string;
  state: string | null;
  country: string;
};

export type CitySelection = { query: string; city: CityOption };

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export function cityLabel(c: CityOption): string {
  return [c.name, c.state, c.country].filter(Boolean).join(", ");
}

/**
 * Accessible city autocomplete (ARIA combobox + listbox) over GET /api/cities.
 * Debounced, aborts stale requests; the browser cache serves repeated queries.
 */
export function CityCombobox({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: CitySelection | null;
  onChange: (value: CitySelection | null) => void;
  invalid?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value ? cityLabel(value.city) : "");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CityOption[]>([]);
  /** Query the current options answer; avoids "No cities found" while a request is pending. */
  const [resultsFor, setResultsFor] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { cities: CityOption[] };
        setOptions(body.cities);
        setResultsFor(q);
        setActive(body.cities.length > 0 ? 0 : -1);
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(err);
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function select(city: CityOption) {
    onChange({ query: query.trim(), city });
    setText(cityLabel(city));
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (options.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" && open && active >= 0 && options[active]) {
      e.preventDefault();
      select(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const tooShort = query.trim().length < MIN_QUERY;
  const showList = open && !tooShort;

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. Rome"
        className="h-11 text-base"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Let a click on an option land before the list closes.
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
      />
      {status === "loading" && showList && (
        <Loader2
          className="absolute top-3.5 right-3 size-4 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="City suggestions"
        className={cn(
          "absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-md",
          !showList && "hidden",
        )}
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((c, i) => (
          <li
            key={c.osmRef}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm",
              i === active && "bg-muted",
            )}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              clearTimeout(blurTimer.current);
              select(c);
            }}
          >
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {", "}
                {[c.state, c.country].filter(Boolean).join(", ")}
              </span>
            </span>
          </li>
        ))}
        {options.length === 0 && status === "idle" && resultsFor === query.trim() && (
          <li className="px-2 py-2 text-sm text-muted-foreground">No cities found.</li>
        )}
        {status === "error" && (
          <li className="px-2 py-2 text-sm text-destructive">
            City search is unavailable, please retry.
          </li>
        )}
      </ul>
    </div>
  );
}
