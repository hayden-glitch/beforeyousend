import { createFileRoute } from '@tanstack/react-router';
import { TrustPage } from './trust';
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute('/privacy')({
  head: () => ({
    ...seoHead({
      title: "Privacy — Before You Send",
      description: "Your drafts stay yours. What Before You Send collects, how your data is handled, and how to delete your account — in plain language.",
      path: "/privacy",
    }),
  }),
  component: () => <TrustPage kind="privacy" />,
});
