import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder lines while the chat code or a trip's conversation loads. */
export function ChatSkeleton({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i % 2 ? "h-8 w-1/2 self-end" : "h-8 w-3/4"} />
      ))}
    </div>
  );
}
