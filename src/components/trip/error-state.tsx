"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center"
      role="alert"
    >
      <TriangleAlert className="size-8 text-amber-500" aria-hidden />
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
