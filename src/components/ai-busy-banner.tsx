import { connection } from "next/server";
import { Hourglass } from "lucide-react";
import { AI_PAUSED_MESSAGE, AI_PAUSED_TITLE } from "@/lib/ai-busy";
import { llmBudget } from "@/server/ai/runtime";

/** "AI is busy" banner (§7), on every page while the daily LLM budget is used up. */
export async function AiBusyBanner() {
  await connection();
  if (!llmBudget.exhausted()) return null;
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 text-amber-950">
      <p className="mx-auto flex w-full max-w-3xl gap-2 px-4 py-2 text-sm group-has-data-wide/body:max-w-6xl">
        <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">{AI_PAUSED_TITLE}.</strong> {AI_PAUSED_MESSAGE}
        </span>
      </p>
    </div>
  );
}
