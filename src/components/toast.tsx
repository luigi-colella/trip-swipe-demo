"use client";

import { useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

/**
 * Notifications without sonner on first load: its code (and the toaster) loads once the page
 * has loaded, or on the first toast if that comes earlier. Loading it ahead matters: the toasts
 * that report a lost connection must not need the network themselves. Sonner replays the
 * toasts created before its toaster subscribed, so the order in which the imports settle does
 * not matter. If the code cannot be loaded, toasts are logged instead of crashing the page.
 */

let loading: Promise<[typeof import("sonner"), typeof import("@/components/ui/sonner")]> | null =
  null;

function loadSonner() {
  loading ??= Promise.all([import("sonner"), import("@/components/ui/sonner")]).catch(
    (err: unknown) => {
      loading = null; // retried by the next toast
      throw err;
    },
  );
  return loading;
}

function NoToaster() {
  return null;
}

const SonnerToaster = dynamic(
  () =>
    loadSonner().then(
      ([, ui]) => ui.Toaster,
      (err: unknown) => {
        console.error("Could not load notifications", err);
        return NoToaster;
      },
    ),
  { ssr: false },
);

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
  loadSonner().then(
    ([{ toast }]) => toast[kind](message),
    (err: unknown) => console.error(`Could not show "${message}"`, err),
  );
}

export const toast = {
  success: (message: string) => show("success", message),
  info: (message: string) => show("info", message),
  warning: (message: string) => show("warning", message),
  error: (message: string) => show("error", message),
};

/** Mounts sonner's toaster once the first toast is shown; loads its code after the page. */
export function Toaster() {
  useEffect(() => {
    const warm = () => void loadSonner().catch(() => {});
    if (document.readyState === "complete") return warm();
    window.addEventListener("load", warm, { once: true });
    return () => window.removeEventListener("load", warm);
  }, []);
  const mounted = useSyncExternalStore(
    subscribe,
    () => requested,
    () => false,
  );
  return mounted ? <SonnerToaster position="top-center" /> : null;
}
