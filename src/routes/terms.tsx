import { createFileRoute } from '@tanstack/react-router';
import { TrustPage } from './trust';
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute('/terms')({
  head: () => ({
    ...seoHead({
      title: "Terms — Before You Send",
      description: "Clear terms for a practical service: plans, billing and cancellation through Stripe, and what Before You Send is and isn't.",
      path: "/terms",
    }),
  }),
  component: () => <TrustPage kind="terms" />,
});
