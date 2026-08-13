// Folder taxonomy for "The Organizer" — single source of truth, imported by
// the server (system prompt built from it — no drift) and the client (chips).
// Spec: /home/team/shared/organizer-promo-tech-design.md §1.

export type Folder = {
  slug: string;
  label: string;
  subfolders: { slug: string; label: string }[];
};

export const TAXONOMY: Folder[] = [
  {
    slug: "communication",
    label: "Communication",
    subfolders: [
      { slug: "texts-and-emails", label: "Texts & emails" },
      { slug: "calls-and-voicemails", label: "Calls & voicemails" },
      { slug: "app-messages", label: "App messages" },
    ],
  },
  {
    slug: "schedule",
    label: "Schedule & Exchanges",
    subfolders: [
      { slug: "plans-and-agreements", label: "Plans & agreements" },
      { slug: "changes-and-conflicts", label: "Changes & conflicts" },
      { slug: "pickup-dropoff", label: "Pickup / drop-off" },
    ],
  },
  {
    slug: "health",
    label: "Health & Medical",
    subfolders: [
      { slug: "records", label: "Records" },
      { slug: "appointments", label: "Appointments" },
      { slug: "bills-insurance", label: "Bills & insurance" },
    ],
  },
  {
    slug: "school",
    label: "School & Education",
    subfolders: [
      { slug: "records", label: "Records" },
      { slug: "communications", label: "Communications" },
      { slug: "special-education", label: "Special education" },
    ],
  },
  {
    slug: "finances",
    label: "Finances",
    subfolders: [
      { slug: "child-support", label: "Child support" },
      { slug: "shared-expenses", label: "Shared expenses" },
      { slug: "receipts", label: "Receipts" },
    ],
  },
  {
    slug: "legal",
    label: "Legal & Court",
    subfolders: [
      { slug: "orders-and-agreements", label: "Orders & agreements" },
      { slug: "filings", label: "Filings" },
      { slug: "attorney-notes", label: "Attorney notes" },
    ],
  },
  {
    slug: "other",
    label: "Other",
    subfolders: [{ slug: "needs-sorting", label: "Needs sorting" }],
  },
];

export function folderBySlug(slug: string): Folder | undefined {
  return TAXONOMY.find((f) => f.slug === slug);
}

export function subfolderLabel(folderSlug: string, subSlug: string): string {
  const f = folderBySlug(folderSlug);
  if (!f) return subSlug;
  return f.subfolders.find((s) => s.slug === subSlug)?.label || subSlug;
}

export function folderLabel(slug: string): string {
  return folderBySlug(slug)?.label || slug;
}
