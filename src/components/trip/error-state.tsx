"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hourglass, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AI_PAUSED_TITLE } from "@/lib/ai-busy";

function StatePanel({
  icon,
  title,
  message,
  retry,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  retry: () => void;
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
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">New trip</Link>
        </Button>
      </div>
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
      retry={retry}
    />
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
      retry={() => router.refresh()}
    />
  );
}
