import { Skeleton } from "@/components/ui/skeleton";

export function TripHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-3" aria-hidden>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-6 w-full max-w-xs" />
    </div>
  );
}

/** Same footprint as the real deck, so nothing shifts when it streams in. */
export function DeckSkeleton({ message = "Loading places…" }: { message?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3" role="status">
      <Skeleton className="h-5 w-full" />
      <div className="relative mx-auto flex h-[min(34rem,calc(100dvh-21rem))] min-h-72 w-full max-w-sm flex-col overflow-hidden rounded-2xl border">
        <Skeleton className="flex-1 rounded-none" />
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
