import { createFileRoute } from '@tanstack/react-router';
import { TrustPage } from './trust';
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute('/about')({
  head: () => ({
    ...seoHead({
      title: "About — Before You Send",
      description: "Before You Send is the pause before every message that matters — communication guidance and organization for fathers in high-conflict co-parenting. Not legal advice.",
      path: "/about",
    }),
  }),
  component: () => <TrustPage kind="about" />,
});
