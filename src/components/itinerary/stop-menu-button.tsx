import type { ComponentProps } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The "⋮" button that opens a stop's quick actions (F4). */
export function StopMenuButton({ name, ...props }: { name: string } & ComponentProps<"button">) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-mr-1 size-9 shrink-0"
      aria-label={`Change ${name}`}
      {...props}
    >
      <MoreVertical className="size-4" />
    </Button>
  );
}
