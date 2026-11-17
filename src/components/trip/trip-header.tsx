import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "cn";
import { PACE_LABELS, type Pace, type TripStatus } from "@/lib/trip";

type Step = "swipe" | "review" | "itinerary";

/** Trip summary + Setup → Swipe → Review → Itinerary stepper. */
export function TripHeader({
  tripId,
  city,
  days,
  pace,
  status,
  current,
}: {
  tripId: string;
  city: string;
  days: number;
  pace: Pace;
  status: TripStatus;
  current: Step;
}) {
  const steps: { key: string; label: string; href?: string; done: boolean }[] = [
    { key: "setup", label: "Setup", done: true },
    { key: "swipe", label: "Swipe", href: `/trip/${tripId}/swipe`, done: current !== "swipe" },
    {
      key: "review",
      label: "Review",
      href: status === "swiping" ? undefined : `/trip/${tripId}/review`,
      done: current === "itinerary",
    },
    {
      key: "itinerary",
      label: "Itinerary",
      href: status === "itinerary" ? `/trip/${tripId}/itinerary` : undefined,
      done: false,
    },
  ];

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="truncate text-lg font-semibold tracking-tight">{city}</h1>
        <p className="shrink-0 text-sm text-muted-foreground">
          {days} {days === 1 ? "day" : "days"} · {PACE_LABELS[pace]}
        </p>
      </div>
      <nav aria-label="Trip progress">
        <ol className="flex items-center gap-1 text-xs sm:text-sm">
          {steps.map((s, i) => {
            const isCurrent = s.key === current;
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[0.7rem]",
                    isCurrent && "border-foreground bg-foreground text-background",
                    s.done && "border-foreground",
                  )}
                  aria-hidden
                >
                  {s.done ? <Check className="size-3" /> : i + 1}
                </span>
                {/* Below 360 px only the current step is named on screen (all are for readers). */}
                <span className={cn(!isCurrent && "max-[359px]:sr-only")}>{s.label}</span>
              </>
            );
            const className = cn(
              "flex items-center gap-1.5 rounded-md px-1 py-0.5",
              isCurrent ? "font-semibold" : "text-muted-foreground",
            );
            return (
              <li key={s.key} className="flex items-center gap-1">
                {/* Short connectors on phones: the four steps must fit 320 px. */}
                {i > 0 && <span className="h-px w-2 bg-border sm:w-6" aria-hidden />}
                {s.href && !isCurrent ? (
                  <Link
                    href={s.href}
                    className={cn(
                      className,
                      "outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    )}
                  >
                    {content}
                  </Link>
                ) : (
                  <span className={className} aria-current={isCurrent ? "step" : undefined}>
                    {content}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
