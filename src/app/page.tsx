import { TripSetupForm } from "@/components/setup/trip-setup-form";

/** F1 – Trip setup. Fully static: the form is the only client island. */
export default function Home() {
  return (
    <div className="flex flex-col gap-6 py-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Plan a city trip</h1>
        <p className="text-muted-foreground">
          Pick a city, swipe through its attractions and get a realistic day-by-day plan.
        </p>
      </div>
      <TripSetupForm />
    </div>
  );
}
