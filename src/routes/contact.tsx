import { createFileRoute } from '@tanstack/react-router';
import { TrustPage } from './trust';
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute('/contact')({
  head: () => ({
    ...seoHead({
      title: "Contact — Before You Send",
      description: "Talk to a real person: account questions, billing, cancellation, refunds, deletion, or feedback. We aim to respond within one business day.",
      path: "/contact",
    }),
  }),
  component: () => <TrustPage kind="contact" />,
});
