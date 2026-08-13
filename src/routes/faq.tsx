import { createFileRoute } from '@tanstack/react-router';
import { TrustPage } from './trust';
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute('/faq')({
  head: () => ({
    ...seoHead({
      title: "FAQ — Before You Send",
      description: "Straight answers: is this legal advice, can I cancel, what are the plans, what is saved, and what else can I buy.",
      path: "/faq",
    }),
  }),
  component: () => <TrustPage kind="faq" active="faq" />,
});
