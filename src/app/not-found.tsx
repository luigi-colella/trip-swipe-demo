import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This trip doesn&apos;t exist or the link is incomplete.
      </p>
      <Button asChild>
        <Link href="/">Plan a new trip</Link>
      </Button>
    </div>
  );
}
