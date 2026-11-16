/**
 * Links the app may show from AI-generated text (LLM05): https only, and only to the sites
 * the app itself links to (Wikipedia and Wikimedia Commons, Google Maps, OpenStreetMap).
 */

const ALLOWED_HOSTS = ["wikipedia.org", "wikimedia.org", "openstreetmap.org"];

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The normalized URL when it may be linked, otherwise null. */
export function allowedLink(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname;
  const allowed =
    ALLOWED_HOSTS.some((domain) => hostIs(host, domain)) ||
    host === "maps.google.com" ||
    ((host === "google.com" || host === "www.google.com") && url.pathname.startsWith("/maps"));
  return allowed ? url.href : null;
}
