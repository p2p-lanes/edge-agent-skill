// Public documentary sources only. Never put tokens or private data here.
export const EVENT = {
  name: "Edge City India 2026",
  slug: "edge-india-2026",
  start: "2026-10-11",
  end: "2026-11-01",
  timezone: "Asia/Kolkata",
  portal: "https://portal.edgecity.live/portal/edge-india",
  wikiId: "038d45cdfc5983c7a1fe013fdc77135b",
  wikiUrl: "https://edgecity.notion.site/Edge-City-India-2026-Wiki-038d45cdfc5983c7a1fe013fdc77135b",
  newsletter: "https://edgecityindia2026.substack.com",
  website: "https://www.edgecity.live/india26",
} as const;

export const WEBSITE_PAGES = [
  { url: EVENT.website, path: "website-content.md" },
  { url: "https://www.edgecity.live/about", path: "website/about.md" },
  {
    url: "https://www.edgecity.live/blog/creator-residency-goa-modern-renaissance",
    path: "residencies/creator-residency.md",
  },
  {
    url: "https://www.edgecity.live/blog/community-builders-residency-goa",
    path: "residencies/community-builders.md",
  },
] as const;

// Fetch only explicitly approved origins, never linked housing sheets, forms,
// attendee portals, Telegram invite histories, or arbitrary residency websites.
export const PUBLIC_HOSTS = new Set([
  "www.edgecity.live",
  "edgecity.live",
  "edgecityindia2026.substack.com",
]);
