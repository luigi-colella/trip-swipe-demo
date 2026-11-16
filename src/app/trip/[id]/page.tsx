import { Suspense } from "react";
import { redirect } from "next/navigation";
import { loadTripOr404 } from "@/server/trips/load";

/** /trip/[id] opens the furthest step the trip has reached. */
export default function TripPage({ params }: PageProps<"/trip/[id]">) {
  return (
    <Suspense>
      {params.then(({ id }) => (
        <RedirectToStep id={id} />
      ))}
    </Suspense>
  );
}

async function RedirectToStep({ id }: { id: string }): Promise<never> {
  const { trip } = await loadTripOr404(id);
  redirect(`/trip/${trip.id}/${trip.status === "swiping" ? "swipe" : "review"}`);
}
