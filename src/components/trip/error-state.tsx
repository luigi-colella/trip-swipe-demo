"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hourglass, MapPinOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AI_PAUSED_TITLE } from "@/lib/ai-busy";

function StatePanel({
  icon,
  title,
  message,
  children,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  /** Extra text under the message, then the actions. */
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center"
      role="alert"
    >
      {icon}
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      {children}
    </div>
  );
}

/** "Try again" plus a way out: for failures that may pass. */
function RetryActions({ retry }: { retry: () => void }) {
  return (
    <div className="flex gap-2">
      <Button onClick={() => retry()}>Try again</Button>
      <Button variant="outline" asChild>
        <Link href="/">New trip</Link>
      </Button>
    </div>
  );
}

/** Shared body of the trip error boundaries: clear message, retry, way out. */
export function ErrorState({
  error,
  retry,
  title,
  message,
}: {
  error: unknown;
  retry: () => void;
  title: string;
  message: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatePanel
      icon={<TriangleAlert className="size-8 text-amber-500" aria-hidden />}
      title={title}
      message={message}
    >
      <RetryActions retry={retry} />
    </StatePanel>
  );
}

/** A step that needs the AI while it is busy (§7): not an error, so nothing is logged. */
export function AiBusyState({ message }: { message: string }) {
  const router = useRouter();
  return (
    <StatePanel
      icon={<Hourglass className="size-8 text-amber-500" aria-hidden />}
      title={AI_PAUSED_TITLE}
      message={message}
    >
      <RetryActions retry={() => router.refresh()} />
    </StatePanel>
  );
}

/**
 * A city where discovery found nothing verifiable (F2): retrying would not help, so the only
 * action is another city. `offlineHint` explains LLM_MODE=fake (decided on the server).
 */
export function NoPlacesState({ city, offlineHint }: { city: string; offlineHint?: string }) {
  return (
    <StatePanel
      icon={<MapPinOff className="size-8 text-amber-500" aria-hidden />}
      title={`No attractions found for ${city}`}
      message="We couldn't find attractions we can verify for this city. Try another city, or a larger one nearby."
    >
      {offlineHint && <p className="max-w-sm text-sm text-muted-foreground">{offlineHint}</p>}
      <Button asChild>
        <Link href="/">Choose another city</Link>
      </Button>
    </StatePanel>
  );
}
