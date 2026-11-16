"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  ExternalLink,
  List,
  LoaderCircle,
  Map as MapIcon,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LatLon } from "@/lib/geo";
import {
  applyItineraryEdit,
  formatClock,
  paceMinutes,
  scheduleItineraryDay,
  type ItineraryData,
  type ItineraryEdit,
  type ItineraryPlace,
} from "@/lib/itinerary";
import { googleMapsDayUrls } from "@/lib/maps-url";
import { formatVisitTime } from "@/lib/places";
import { PACE_LABELS, type Pace } from "@/lib/trip";
import {
  editItineraryAction,
  regenerateItineraryAction,
  undoItineraryAction,
} from "@/server/actions/itinerary";
import type { MapStop } from "@/components/map/itinerary-map";
import { useIsDesktop } from "@/components/use-is-desktop";
import { DayTimeline } from "./day-timeline";

function MapSkeleton() {
  return <Skeleton className="size-full rounded-none" />;
}

/** Leaflet is loaded only when a map is actually shown (desktop, or the mobile Map toggle). */
const ItineraryMap = dynamic(() => import("@/components/map/itinerary-map"), {
  ssr: false,
  loading: MapSkeleton,
});

function reduceEdit(data: ItineraryData, edit: ItineraryEdit): ItineraryData {
  return applyItineraryEdit(data, edit) ?? data;
}

/** F4 + F5 + F7: day tabs with timelines, map, Google Maps links, quick actions and undo. */
export function ItineraryView({
  tripId,
  pace,
  data,
  canUndo,
  places,
  center,
}: {
  tripId: string;
  pace: Pace;
  data: ItineraryData;
  canUndo: boolean;
  places: ItineraryPlace[];
  center: LatLon;
}) {
  const [itinerary, applyEdit] = useOptimistic(data, reduceEdit);
  const [editing, startEdit] = useTransition();
  const [regenerating, startRegenerate] = useTransition();
  const [day, setDay] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const isDesktop = useIsDesktop();

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const budget = paceMinutes(pace);
  const schedules = useMemo(
    () => itinerary.days.map((d) => scheduleItineraryDay(d, byId, budget)),
    [itinerary, byId, budget],
  );
  const busy = editing || regenerating;
  const current = Math.min(day, itinerary.days.length - 1);
  const titles = itinerary.days.map((d) => d.title);

  const mapStops: MapStop[] = schedules[current].items.flatMap((item) => {
    if (item.kind !== "visit") return [];
    const p = byId.get(item.placeId)!;
    return [{ id: p.id, number: item.number, name: p.name, lat: p.lat, lon: p.lon }];
  });

  function edit(change: ItineraryEdit, place: ItineraryPlace) {
    startEdit(async () => {
      applyEdit(change);
      const r = await editItineraryAction(tripId, change);
      if (!r.ok) toast.error(`Couldn't change ${place.name}: ${r.error}`);
      else if (change.type === "change-day")
        toast.success(`${place.name} moved to Day ${change.day + 1}.`);
    });
  }

  function undo() {
    startEdit(async () => {
      const r = await undoItineraryAction(tripId);
      if (!r.ok) toast.error(r.error);
    });
  }

  function regenerate() {
    startRegenerate(async () => {
      const r = await regenerateItineraryAction(tripId);
      if (!r.ok) toast.error(r.error);
      else if (r.data.source === "fallback") {
        toast.warning("The AI planner is unavailable, so this plan was built by rules only.");
      } else toast.success("Here's a new plan. Undo brings the previous one back.");
    });
  }

  function selectFromMap(id: string) {
    setSelectedId(id);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`stop-${id}`)
      ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }

  const showMap = isDesktop || view === "map";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {itinerary.source === "ai" ? (
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="size-3" aria-hidden /> AI-generated
          </Badge>
        ) : (
          <Badge variant="outline">Planned by rules</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo || busy}>
            <Undo2 aria-hidden /> Undo
          </Button>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
            {regenerating ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            New plan
          </Button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {regenerating ? "Planning a new itinerary…" : ""}
      </p>

      <Tabs
        value={`day-${current}`}
        onValueChange={(v) => {
          setDay(Number(v.slice(4)));
          setSelectedId(null);
        }}
        className={cn("gap-3", regenerating && "pointer-events-none opacity-60")}
      >
        <TabsList className="h-9 w-full justify-start overflow-x-auto">
          {itinerary.days.map((_, i) => (
            <TabsTrigger key={i} value={`day-${i}`} className="min-w-16 flex-none px-3">
              Day {i + 1}
            </TabsTrigger>
          ))}
        </TabsList>

        {itinerary.days.map((d, i) => {
          const schedule = schedules[i];
          const stops = schedule.items.flatMap((it) =>
            it.kind === "visit" ? [byId.get(it.placeId)!] : [],
          );
          const links = googleMapsDayUrls(stops);
          return (
            <TabsContent key={i} value={`day-${i}`} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold">{d.title}</h2>
                {stops.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    <span className="tabular-nums">
                      {formatClock(schedule.start)} – {formatClock(schedule.end)}
                    </span>{" "}
                    · {formatVisitTime(schedule.activeMinutes)} of visits and travel
                  </p>
                )}
                {schedule.overMinutes > 0 && (
                  <p className="flex items-center gap-1.5 text-sm text-amber-800">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    Over your {PACE_LABELS[pace].toLowerCase()} pace by{" "}
                    {formatVisitTime(schedule.overMinutes)}.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 lg:hidden" role="group" aria-label="View">
                <Button
                  size="sm"
                  variant={view === "list" ? "default" : "outline"}
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List aria-hidden /> List
                </Button>
                <Button
                  size="sm"
                  variant={view === "map" ? "default" : "outline"}
                  aria-pressed={view === "map"}
                  onClick={() => setView("map")}
                >
                  <MapIcon aria-hidden /> Map
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
                <div className={cn("flex flex-col gap-3", view === "map" && "max-lg:hidden")}>
                  <DayTimeline
                    dayIndex={i}
                    day={d}
                    schedule={schedule}
                    days={titles}
                    places={byId}
                    selectedId={selectedId}
                    disabled={busy}
                    onSelect={setSelectedId}
                    onEdit={edit}
                  />
                  {links.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {links.map((href, n) => (
                        <Button key={href} variant="outline" size="sm" asChild>
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            <ExternalLink aria-hidden />
                            {links.length > 1
                              ? `Google Maps, part ${n + 1}`
                              : "Open in Google Maps"}
                          </a>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                {showMap && i === current && (
                  <div
                    className={cn(
                      "isolate h-[min(60dvh,30rem)] overflow-hidden rounded-xl border lg:sticky lg:top-4 lg:h-[min(calc(100dvh-6rem),40rem)]",
                      view === "list" && "max-lg:hidden",
                    )}
                    role="region"
                    aria-label={`Map of day ${i + 1}`}
                  >
                    <ItineraryMap
                      stops={mapStops}
                      center={center}
                      selectedId={selectedId}
                      onSelect={selectFromMap}
                    />
                  </div>
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {itinerary.excluded.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="excluded-heading">
          <h2 id="excluded-heading" className="text-sm font-semibold">
            Not in the plan ({itinerary.excluded.length})
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {itinerary.excluded.map((x) => {
              const p = byId.get(x.placeId);
              return p ? (
                <li key={x.placeId} className="flex flex-wrap gap-x-1.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">— {x.reason}</span>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        {itinerary.source === "ai"
          ? "Suggestions and tips are AI-generated. "
          : "The AI planner couldn't produce a valid plan this time, so this one was built by rules only. "}
        Travel times are estimates; check opening hours before you go.
      </p>
    </div>
  );
}
