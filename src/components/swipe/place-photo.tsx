"use client";

import { useState } from "react";
import Image from "next/image";
import { Landmark } from "lucide-react";
import { cn } from "cn";

/**
 * Wikimedia thumbnail (already sized by Commons, so no optimization round-trip) with a neutral
 * fallback when the place has no licensed photo or the image fails to load.
 */
export function PlacePhoto({
  src,
  alt,
  sizes,
  eager,
  fetchPriority,
  className,
}: {
  src: string | null;
  alt: string;
  sizes: string;
  eager?: boolean;
  fetchPriority?: "high" | "low";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex size-full items-center justify-center bg-linear-to-br from-rose-100 to-amber-100",
          className,
        )}
        role="img"
        aria-label={`${alt} (no photo available)`}
      >
        <Landmark className="size-12 text-rose-300" aria-hidden />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={fetchPriority}
      draggable={false}
      className={cn("object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
