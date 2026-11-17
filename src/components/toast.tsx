"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

/**
 * Notifications without sonner on first load: its code (and the toaster) loads on the first
 * toast. Sonner replays the toasts created before its toaster subscribed, so the order in
 * which the two imports settle does not matter.
 */

const SonnerToaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), {
  ssr: false,
});

type Kind = "success" | "info" | "warning" | "error";

let requested = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function show(kind: Kind, message: string) {
  if (!requested) {
    requested = true;
    for (const listener of listeners) listener();
  }
  void import("sonner").then(({ toast }) => toast[kind](message));
}

export const toast = {
  success: (message: string) => show("success", message),
  info: (message: string) => show("info", message),
  warning: (message: string) => show("warning", message),
  error: (message: string) => show("error", message),
};

/** Mounts sonner's toaster once the first toast is shown. */
export function Toaster() {
  const mounted = useSyncExternalStore(
    subscribe,
    () => requested,
    () => false,
  );
  return mounted ? <SonnerToaster position="top-center" /> : null;
}
