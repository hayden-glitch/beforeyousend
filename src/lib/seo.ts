// SEO head helper — per-page title/meta description + canonical + Open Graph +
// Twitter card tags, emitted in each public route's head(). beforeyousend.org
// (apex) is canonical; www and the *.vercel.app aliases all 301/alias to it.
// Honesty rails: every description is a real, current description of the page
// (prices/caps match the pricing page) — no fabricated claims or urgency.
export const SITE_URL = "https://beforeyousend.org";
export const OG_IMAGE = `${SITE_URL}/og.png`;

export interface SeoOptions {
  title: string;
  description: string;
  /** Route path, e.g. "/pricing". "/" for the landing page. */
  path: string;
}

/**
 * Returns the meta + links arrays for a route's head(). Spread the result into
 * the route head object: `head: () => ({ ...seoHead({...}) })`. Keep any
 * route-specific `scripts` beside it (see index.tsx).
 */
export function seoHead(opts: SeoOptions) {
  const url = `${SITE_URL}${opts.path}`;
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Before You Send" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: opts.title },
      { name: "twitter:description", content: opts.description },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
