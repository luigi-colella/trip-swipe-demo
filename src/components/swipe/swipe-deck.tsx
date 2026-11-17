"use client";

import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react";
import { Heart, ListChecks, Loader2, RotateCcw, Sparkles, Star, X } from "lucide-react";
import { toast } from "@/components/toast";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { deckReducer, shortlistCount, type DeckEntry } from "@/lib/deck";
import type { PlaceCard } from "@/lib/places";
import type { SwipeDecision } from "@/lib/trip";
import {
  loadMorePlacesAction,
  recordSwipeAction,
  startReviewAction,
  undoSwipeAction,
} from "@/server/actions/trips";
import { PlaceCardView } from "./place-card";
import { defined } from "@/lib/invariant";

/** Only the top cards live in the DOM; the next ones just get their photo preloaded. */
const VISIBLE_CARDS = 3;
const PRELOADED_PHOTOS = 2;
/** Drag distance (px) or fling speed (px/ms) that commits a swipe. */
const SWIPE_DISTANCE = 100;
const FLING_SPEED = 0.5;
const FLING_MIN_DISTANCE = 30;
const EXIT_MS = 260;

const DECISION_VERB: Record<SwipeDecision, string> = {
  like: "Liked",
  skip: "Skipped",
  must: "Must-see",
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** F3 – Swipe deck with drag/fling, buttons, keyboard and undo; F8 re-ranks after each swipe. */
export function SwipeDeck({
  tripId,
  interests,
  initialDeck,
  initialHistory,
}: {
  tripId: string;
  interests: string[];
  initialDeck: PlaceCard[];
  initialHistory: DeckEntry[];
}) {
  const [state, dispatch] = useReducer(deckReducer, {
    deck: initialDeck,
    history: initialHistory,
    interests,
  });
  const [announcement, setAnnouncement] = useState("");
  const [loadingMore, startLoadMore] = useTransition();
  const [reviewPending, startReview] = useTransition();
  const topCard = useRef<CardHandle>(null);

  const top = state.deck[0];
  const liked = shortlistCount(state.history);
  const total = state.deck.length + state.history.length;

  // Swipes are applied instantly and saved in the background; failures are rolled back.
  function commit(place: PlaceCard, decision: SwipeDecision) {
    dispatch({ type: "swipe", placeId: place.id, decision });
    setAnnouncement(`${DECISION_VERB[decision]}: ${place.name}`);
    recordSwipeAction(tripId, place.id, decision)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
      })
      .catch((err: unknown) => {
        console.error(err);
        dispatch({ type: "revert-swipe", placeId: place.id });
        toast.error(`Couldn't save your choice for ${place.name}. Please try again.`);
      });
  }

  function undo() {
    const last = state.history.at(-1);
    if (!last) return;
    dispatch({ type: "undo", placeId: last.place.id });
    setAnnouncement(`Undone: ${last.place.name}`);
    undoSwipeAction(tripId, last.place.id)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
      })
      .catch((err: unknown) => {
        console.error(err);
        dispatch({ type: "revert-undo", entry: last });
        toast.error("Couldn't undo, please try again.");
      });
  }

  function decide(decision: SwipeDecision) {
    topCard.current?.fling(decision);
  }

  function loadMore() {
    startLoadMore(async () => {
      const r = await loadMorePlacesAction(tripId);
      if (!r.ok) toast.error(r.error);
      else if (r.data.length === 0) toast.info("No new places found for this city.");
      else dispatch({ type: "append", places: r.data });
    });
  }

  function review() {
    startReview(async () => {
      const r = await startReviewAction(tripId);
      if (!r.ok) toast.error(r.error);
    });
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const typing = "input, textarea, select, [contenteditable]";
    if (e.target instanceof Element && e.target.closest(typing)) return;
    const map: Record<string, SwipeDecision> = {
      ArrowLeft: "skip",
      ArrowRight: "like",
      ArrowUp: "must",
    };
    if (map[e.key] && top) {
      e.preventDefault();
      decide(map[e.key]);
    } else if (e.key === "Backspace" || e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Warm the browser cache for the photos right after the cards in the DOM, once the page has
  // loaded: on a slow network they would otherwise compete with the top card's photo (LCP).
  const upcoming = state.deck
    .slice(VISIBLE_CARDS, VISIBLE_CARDS + PRELOADED_PHOTOS)
    .flatMap((p) => p.imageUrl ?? []);
  const upcomingKey = upcoming.join("|");
  useEffect(() => {
    const preload = () => {
      for (const src of upcomingKey.split("|").filter(Boolean)) {
        const img = new window.Image();
        img.src = src;
      }
    };
    if (document.readyState === "complete") return preload();
    window.addEventListener("load", preload, { once: true });
    return () => window.removeEventListener("load", preload);
  }, [upcomingKey]);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {top ? (
            <>
              Place <span className="font-medium text-foreground">{state.history.length + 1}</span>{" "}
              of {total}
            </>
          ) : (
            <>All {total} places seen</>
          )}
        </span>
        <span className="flex items-center gap-1">
          <Heart className="size-3.5 fill-rose-500 text-rose-500" aria-hidden />
          {liked} in shortlist
        </span>
      </div>

      <div
        className="relative mx-auto h-[min(34rem,calc(100dvh-21rem))] min-h-72 w-full max-w-sm"
        role="group"
        aria-roledescription="card stack"
        aria-label="Places to swipe"
      >
        {top ? (
          state.deck
            .slice(0, VISIBLE_CARDS)
            .map((place, position) => (
              <DeckCard
                key={place.id}
                ref={position === 0 ? topCard : undefined}
                place={place}
                position={position}
                onDecide={(decision) => commit(place, decision)}
              />
            ))
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-6 text-center">
            <Sparkles className="size-8 text-rose-400" aria-hidden />
            <div className="flex flex-col gap-1">
              <h2 className="font-semibold">You&apos;ve seen every place</h2>
              <p className="text-sm text-muted-foreground">
                Load more attractions or review your shortlist.
              </p>
            </div>
            <Button variant="outline" size="lg" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="animate-spin" aria-hidden />}
              {loadingMore ? "Finding more places…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3">
        <RoundButton
          label="Undo"
          shortcut="Backspace"
          onClick={undo}
          disabled={state.history.length === 0}
          className="size-11 text-muted-foreground"
        >
          <RotateCcw className="size-5" />
        </RoundButton>
        <RoundButton
          label="Skip"
          shortcut="ArrowLeft"
          onClick={() => decide("skip")}
          disabled={!top}
          className="size-14 text-slate-600"
        >
          <X className="size-7" />
        </RoundButton>
        <RoundButton
          label="Must-see"
          shortcut="ArrowUp"
          onClick={() => decide("must")}
          disabled={!top}
          className="size-12 text-amber-500"
        >
          <Star className="size-6 fill-current" />
        </RoundButton>
        <RoundButton
          label="Like"
          shortcut="ArrowRight"
          onClick={() => decide("like")}
          disabled={!top}
          className="size-14 text-rose-500"
        >
          <Heart className="size-7 fill-current" />
        </RoundButton>
      </div>

      <Button
        size="lg"
        className="mx-auto h-10 w-full max-w-sm"
        onClick={review}
        disabled={liked === 0 || reviewPending}
      >
        {reviewPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <ListChecks aria-hidden />
        )}
        Review shortlist ({liked})
      </Button>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function RoundButton({
  label,
  shortcut,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { label: string; shortcut: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={label}
      className={cn(
        "flex items-center justify-center rounded-full border bg-background shadow-sm transition-transform outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

type CardHandle = { fling: (decision: SwipeDecision) => void };

/**
 * One card of the stack. The top card follows the pointer through direct style writes
 * (no React render per pointer move), then flies out and reports the decision.
 */
function DeckCard({
  place,
  position,
  onDecide,
  ref,
}: {
  place: PlaceCard;
  position: number;
  onDecide: (decision: SwipeDecision) => void;
  ref?: Ref<CardHandle>;
}) {
  const node = useRef<HTMLDivElement>(null);
  const stamps = useRef<Record<SwipeDecision, HTMLSpanElement | null>>({
    like: null,
    skip: null,
    must: null,
  });
  const drag = useRef<{ x: number; y: number; t: number; dx: number; dy: number } | null>(null);
  const leaving = useRef(false);
  const isTop = position === 0;

  function showStamps(dx: number, dy: number) {
    const clamp = (v: number) => String(Math.max(0, Math.min(1, v / SWIPE_DISTANCE)));
    const up = -dy > Math.abs(dx);
    // Only the top card has stamps, and only the top card can be dragged or flung.
    stamps.current.like?.style.setProperty("opacity", up ? "0" : clamp(dx));
    stamps.current.skip?.style.setProperty("opacity", up ? "0" : clamp(-dx));
    stamps.current.must?.style.setProperty("opacity", up ? clamp(-dy) : "0");
  }

  function fling(decision: SwipeDecision) {
    if (leaving.current) return;
    const el = defined(node.current, "the card element");
    leaving.current = true;
    if (prefersReducedMotion()) {
      onDecide(decision);
      return;
    }
    const w = window.innerWidth;
    const x = decision === "like" ? w : decision === "skip" ? -w : 0;
    const y = decision === "must" ? -window.innerHeight : (drag.current?.dy ?? 0);
    showStamps(x, decision === "must" ? -SWIPE_DISTANCE : 0);
    el.style.transition = `transform ${EXIT_MS}ms ease-out`;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${x / 40}deg)`;
    setTimeout(() => onDecide(decision), EXIT_MS);
  }

  useImperativeHandle(ref, () => ({ fling }));

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isTop || leaving.current || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a, button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, dy: 0 };
    e.currentTarget.style.transition = "none";
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    e.currentTarget.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx / 20}deg)`;
    showStamps(d.dx, d.dy);
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const { dx, dy } = d;
    const speed = dx / Math.max(1, performance.now() - d.t);
    let decision: SwipeDecision | null = null;
    if (dx > SWIPE_DISTANCE || (speed > FLING_SPEED && dx > FLING_MIN_DISTANCE)) decision = "like";
    else if (dx < -SWIPE_DISTANCE || (speed < -FLING_SPEED && dx < -FLING_MIN_DISTANCE))
      decision = "skip";
    else if (dy < -SWIPE_DISTANCE && -dy > Math.abs(dx)) decision = "must";

    if (decision && e.type === "pointerup") {
      fling(decision);
    } else {
      drag.current = null;
      e.currentTarget.style.transition = "transform 200ms ease-out";
      e.currentTarget.style.transform = "";
      showStamps(0, 0);
    }
  }

  return (
    <div
      ref={node}
      className={cn(
        "absolute inset-0 transition-transform duration-200 motion-reduce:transition-none",
        isTop && "cursor-grab touch-none active:cursor-grabbing",
      )}
      style={{
        zIndex: VISIBLE_CARDS - position,
        transform: isTop
          ? undefined
          : `translateY(${position * 10}px) scale(${1 - position * 0.04})`,
      }}
      aria-hidden={!isTop || undefined}
      inert={!isTop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {/* The top card's photo is the LCP: the cards behind it must not compete for bandwidth. */}
      <PlaceCardView place={place} eager fetchPriority={isTop ? "high" : "low"} />
      {isTop && (
        <>
          <Stamp
            ref={(el) => {
              stamps.current.like = el;
            }}
            className="top-6 left-5 -rotate-12 border-emerald-500 text-emerald-500"
          >
            Like
          </Stamp>
          <Stamp
            ref={(el) => {
              stamps.current.skip = el;
            }}
            className="top-6 right-5 rotate-12 border-slate-500 text-slate-500"
          >
            Skip
          </Stamp>
          <Stamp
            ref={(el) => {
              stamps.current.must = el;
            }}
            className="bottom-40 left-1/2 -translate-x-1/2 border-amber-500 text-amber-500"
          >
            Must-see
          </Stamp>
        </>
      )}
    </div>
  );
}

function Stamp({
  className,
  children,
  ref,
}: {
  className: string;
  children: React.ReactNode;
  ref: Ref<HTMLSpanElement>;
}) {
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute rounded-md border-4 bg-background/80 px-2 py-0.5 text-2xl font-extrabold tracking-wider uppercase opacity-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
