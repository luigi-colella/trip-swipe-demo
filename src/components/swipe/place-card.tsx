import { BadgeCheck, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatVisitTime, humanizeSlug, type PlaceCard as Place } from "@/lib/places";
import { PlacePhoto } from "./place-photo";

const link =
  "underline-offset-2 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50";

/** F2 + F9: photo, name, category, visit time, pitch and provenance. */
export function PlaceCardView({
  place,
  eager,
  fetchPriority,
}: {
  place: Place;
  eager?: boolean;
  fetchPriority?: "high" | "low";
}) {
  return (
    <article className="flex size-full flex-col overflow-hidden rounded-2xl border bg-card shadow-lg select-none">
      <div className="relative min-h-0 flex-1 bg-muted">
        <PlacePhoto
          src={place.imageUrl}
          alt={place.name}
          sizes="(max-width: 640px) 100vw, 384px"
          eager={eager}
          fetchPriority={fetchPriority}
        />
        <Badge variant="secondary" className="absolute top-3 left-3 bg-background/90">
          {humanizeSlug(place.category)}
        </Badge>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg leading-tight font-semibold">{place.name}</h2>
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            <span className="sr-only">Visit time:</span>
            {formatVisitTime(place.visitMinutes)}
          </span>
        </div>
        <p className="line-clamp-3 text-sm text-muted-foreground">{place.pitch}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <a
            href={place.wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1 font-medium text-emerald-700 ${link}`}
          >
            <BadgeCheck className="size-3.5" aria-hidden />
            Verified on Wikipedia
          </a>
          {place.imageUrl && <PhotoCredit place={place} />}
        </div>
      </div>
    </article>
  );
}

function PhotoCredit({ place }: { place: Place }) {
  const author = place.imageAuthor ?? "Unknown author";
  return (
    <span className="min-w-0 truncate">
      Photo:{" "}
      {place.imagePageUrl ? (
        <a href={place.imagePageUrl} target="_blank" rel="noopener noreferrer" className={link}>
          {author}
        </a>
      ) : (
        author
      )}
      {place.imageLicense && (
        <>
          {" · "}
          {place.imageLicenseUrl ? (
            <a
              href={place.imageLicenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              {place.imageLicense}
            </a>
          ) : (
            place.imageLicense
          )}
        </>
      )}
    </span>
  );
}
