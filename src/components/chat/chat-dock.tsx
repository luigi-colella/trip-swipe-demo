"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { MessageCircle, PanelRightClose, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/components/use-is-desktop";
import { isTripId } from "@/lib/trip";
import { ChatSkeleton } from "./chat-skeleton";

/** The conversation code (AI SDK client) loads only when a chat is actually shown. */
const ChatPanel = dynamic(() => import("./chat-panel"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 p-4">
      <ChatSkeleton lines={2} />
    </div>
  ),
});

function ChatHeader({
  onClose,
  closeLabel,
  icon: Icon,
}: {
  onClose: () => void;
  closeLabel: string;
  icon: typeof X;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageCircle className="size-4 text-rose-500" aria-hidden />
        Trip assistant
      </h2>
      <Button variant="ghost" size="icon" onClick={onClose}>
        <Icon aria-hidden />
        <span className="sr-only">{closeLabel}</span>
      </Button>
    </div>
  );
}

/** The chat bound to the trip in the URL (/trip/[id]/…), or to the home page. */
export function ChatDockForRoute() {
  const params = useParams<{ id?: string }>();
  return <ChatDock tripId={isTripId(params.id) ? params.id : null} />;
}

/**
 * F6 – The chat, available on every page (§7): a collapsible pane on the right on desktop,
 * a bottom sheet opened from a floating button on mobile.
 */
export function ChatDock({ tripId }: { tripId: string | null }) {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const showSheet = sheetOpen && !isDesktop;

  useEffect(() => {
    if (!showSheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSheet]);

  const panel = <ChatPanel key={tripId ?? "home"} tripId={tripId} />;

  return (
    <>
      {/* data-chat-open: the root layout leaves room for the pane on desktop. */}
      <aside
        data-chat-open={collapsed ? undefined : ""}
        aria-label="Trip assistant"
        className={cn(
          "fixed inset-y-0 right-0 z-30 w-95 flex-col border-l bg-background",
          collapsed ? "hidden" : "hidden lg:flex",
        )}
      >
        <ChatHeader
          onClose={() => setCollapsed(true)}
          closeLabel="Hide chat"
          icon={PanelRightClose}
        />
        {isDesktop && !collapsed && panel}
      </aside>

      <Button
        size="icon"
        className={cn(
          "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 size-12 rounded-full shadow-lg [&_svg:not([class*='size-'])]:size-5",
          !collapsed && "lg:hidden",
          showSheet && "hidden",
        )}
        onClick={() => (isDesktop ? setCollapsed(false) : setSheetOpen(true))}
      >
        <MessageCircle aria-hidden />
        <span className="sr-only">Open the trip assistant</span>
      </Button>

      {showSheet && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <button
            type="button"
            aria-label="Close the trip assistant"
            tabIndex={-1}
            className="absolute inset-0 bg-black/40"
            onClick={() => setSheetOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Trip assistant"
            className="relative flex h-[85dvh] flex-col rounded-t-2xl border-t bg-background shadow-xl"
          >
            <ChatHeader onClose={() => setSheetOpen(false)} closeLabel="Close chat" icon={X} />
            {panel}
          </div>
        </div>
      )}
    </>
  );
}
