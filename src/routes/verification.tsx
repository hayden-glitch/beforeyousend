import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { track } from "~/lib/analytics";

// Hidden identity-verification page (owner-authorized, 2026-08). Exists ONLY so
// the owner can hand Google's developer/verification reviewer a URL that
// confirms he owns the domain and the website. Deliberately plain — no
// marketing, no testimonials, no dates that could go stale, and the only
// statements are factual owner-identity facts. Hidden exactly like /quiz:
// NO SiteChrome (no header pill nav, no footer links), robots noindex so
// organic search never surfaces it, absent from sitemap.xml (a static file,
// untouched), and the Special Offer modal is suppressed via suppressForPath()
// (/verification added there). Analytics: one verification_viewed event with
// source = "verification", mirroring the /quiz source-param pattern.

export const Route = createFileRoute("/verification")({
  head: () => ({
    meta: [
      { title: "Site ownership verification — Before You Send" },
      {
        name: "description",
        content:
          "Identity-verification page for beforeyousend.org — owned and operated by Hayden Clark (hayden@ntagusa.com).",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Verification,
});

function Verification() {
  useEffect(() => {
    track("verification_viewed", { source: "verification" });
  }, []);

  return (
    <div className="min-h-dvh bg-cream text-ink">
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-xl flex-col px-5 py-10 sm:px-6 sm:py-16"
      >
        <img src="/logo-bys.svg" alt="Before You Send" className="h-9 w-auto" width={160} height={36} />

        <h1 className="mt-8 font-display text-3xl font-semibold leading-tight tracking-tight text-forest">
          Site ownership verification
        </h1>

        <p className="mt-6 text-base leading-relaxed text-stone">To the Google verification reviewer:</p>

        <p className="mt-3 text-base leading-relaxed text-ink">
          This website — beforeyousend.org — and the Before You Send app are owned and operated by
          Hayden Clark (hayden@ntagusa.com).
        </p>

        <p className="mt-4 text-base leading-relaxed text-ink">
          Domain: beforeyousend.org
          <br />
          App: Before You Send
        </p>

        <p className="mt-6 text-base leading-relaxed text-stone">
          This page exists to confirm who owns and operates the site. Thank you for your review.
        </p>
      </main>
    </div>
  );
}
