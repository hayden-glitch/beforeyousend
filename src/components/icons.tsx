// Inline SVG icon set for the Command Center app shell (app-redesign-spec §2.3).
// 24×24 viewBox, stroke-based (matches the existing copy-check icon style),
// zero dependencies. Icons accept an optional className for sizing/color.

import type { ReactNode } from "react";

type IconProps = { className?: string };

function base(children: ReactNode) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Speech bubble with three dots — echoes the B·Y·S typing-indicator mark.
export function IconReview({ className: _className }: IconProps) {
  return base(
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7z" />
      <circle cx="9" cy="10" r="0.4" fill="currentColor" />
      <circle cx="12" cy="10" r="0.4" fill="currentColor" />
      <circle cx="15" cy="10" r="0.4" fill="currentColor" />
    </>,
  );
}

// Clock with a counter-clockwise arrow (history).
export function IconHistory({ className: _className }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
      <path d="M4.5 5.5A8.6 8.6 0 0 0 3.5 12" />
      <path d="M4 5v5h5" />
    </>,
  );
}

// Three list lines with dot markers.
export function IconLog({ className: _className }: IconProps) {
  return base(
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.1" />
      <circle cx="4.5" cy="12" r="1.1" />
      <circle cx="4.5" cy="18" r="1.1" />
    </>,
  );
}

// Calendar outline with a node/dot.
export function IconTimeline({ className: _className }: IconProps) {
  return base(
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
      <path d="M4 10.5h16" />
      <path d="M8.5 3v4.5M15.5 3v4.5" />
      <circle cx="16" cy="16" r="1.7" />
    </>,
  );
}

// 2×2 rounded grid.
export function IconTools({ className: _className }: IconProps) {
  return base(
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>,
  );
}

// Folder outline with three dots (The Organizer).
export function IconOrganizer({ className: _className }: IconProps) {
  return base(
    <>
      <path d="M3.5 8A2.5 2.5 0 0 1 6 5.5h3.6l1.8 2.2H18A2.5 2.5 0 0 1 20.5 10.2v6.3A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5V8z" />
      <circle cx="9" cy="13.5" r="0.5" fill="currentColor" />
      <circle cx="12" cy="13.5" r="0.5" fill="currentColor" />
      <circle cx="15" cy="13.5" r="0.5" fill="currentColor" />
    </>,
  );
}

export function IconMoon({ className: _className }: IconProps) {
  return base(<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" />);
}

export function IconCheck({ className: _className }: IconProps) {
  return base(<path d="M5 13l4 4L19 7" />);
}

export function IconChevronDown({ className: _className }: IconProps) {
  return base(<path d="M6 9l6 6 6-6" />);
}

export function IconClose({ className: _className }: IconProps) {
  return base(<path d="M6 6l12 12M18 6L6 18" />);
}

// Log direction arrow (sent).
export function IconArrowUp({ className: _className }: IconProps) {
  return base(<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />);
}

// Case Summary (open book).
export function IconBook({ className: _className }: IconProps) {
  return base(
    <>
      <path d="M12 6.5C10.2 5 7.4 4.6 4 5.2v13.1c3.4-.6 6.2-.2 8 1.2 1.8-1.4 4.6-1.8 8-1.2V5.2c-3.4-.6-6.2-.2-8 1.3z" />
      <path d="M12 6.5v13" />
    </>,
  );
}

// Action Center (check-circle).
export function IconAction({ className: _className }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5.5" />
    </>,
  );
}

// Plus (add actions) — added by the funnel-rebuild raw-glyph sweep.
export function IconPlus({ className: _className }: IconProps) {
  return base(<path d="M12 5v14M5 12h14" />);
}

// Down arrow (log direction: received).
export function IconArrowDown({ className: _className }: IconProps) {
  return base(<path d="M12 5v14M5.5 12.5L12 19l6.5-6.5" />);
}

// Download — used by the Export pack entry in the Command Center.
export function IconDownload({ className: _className }: IconProps) {
  return base(
    <>
      <path d="M12 4v10" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </>
  );
}
// Gavel — used by the Attorney Prep Pack entry in the Command Center.
export function IconGavel({ className: _className }: IconProps) {
  return base(
    <>
      <path d="m14 6 4 4" />
      <path d="M11.5 11.5 6 17a2.1 2.1 0 0 1-3-3l5.5-5.5" />
      <path d="m8.5 8.5 7 7" />
      <path d="M14 3.5l6.5 6.5" />
      <path d="M5 21h14" />
    </>
  );
}

// Left arrow (back navigation).
export function IconArrowLeft({ className: _className }: IconProps) {
  return base(<path d="M19 12H5M11.5 5.5L5 12l6.5 6.5" />);
}

// Magnifier over a node dot — the Situation Analyzer mode (24×24, stroke 1.8).
export function IconAnalyze({ className: _className }: IconProps) {
  return base(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20.5 20.5" />
      <circle cx="11" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4.5 11h2.2M11 4.5v2.2" />
    </>,
  );
}

// Paperclip — the Steady+ attachment control (spec §3, 24×24 stroke 1.8).
export function IconAttach({ className: _className }: IconProps) {
  return base(
    <path d="M20.5 11.5 12 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.8 3.8 0 0 1 5.4 5.4l-8.5 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8" />,
  );
}
