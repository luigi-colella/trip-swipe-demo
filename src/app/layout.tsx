import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Plane } from "lucide-react";
import { AiBusyBanner } from "@/components/ai-busy-banner";
import { ChatDock, ChatDockForRoute } from "@/components/chat/chat-dock";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TravelSwipe AI",
  description: "Swipe through a city's attractions and get an AI-built itinerary.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* The desktop chat pane is fixed on the right: [data-chat-open] makes room for it. */}
      <body className="group/body flex min-h-dvh flex-col bg-background text-foreground lg:has-data-chat-open:pr-95">
        <header className="border-b pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-12 w-full max-w-3xl items-center px-4 group-has-data-wide/body:max-w-6xl">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Plane className="size-5 text-rose-500" aria-hidden />
              TravelSwipe AI
            </Link>
          </div>
        </header>
        {/* Read at request time: the daily LLM budget changes during the day. */}
        <Suspense fallback={null}>
          <AiBusyBanner />
        </Suspense>
        {/* Pages that render a [data-wide] element (the itinerary: list + map) get a wider column. */}
        {/* Below lg the bottom padding keeps content clear of the floating chat button. */}
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] has-data-wide:max-w-6xl lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </main>
        {/* The trip ID comes from the URL, only known at request time. */}
        <Suspense fallback={<ChatDock tripId={null} />}>
          <ChatDockForRoute />
        </Suspense>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
