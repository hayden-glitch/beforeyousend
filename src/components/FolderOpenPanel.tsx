// FolderOpenPanel — the opened child's space body (owner batch 2, Design 1).
// Rebuilt per 5304729186 §7: NOT a "paper" surface — an in-flow working panel
// rendered directly under the child's row, with two professional sections:
// Ratings (Exchange Tone) and To-Do. Mobile stacks them; sm+ shows them side
// by side. Both stay fully interactive while open.
//
// Honesty rails: the rating is the dad's OWN self-report ("your record and
// your own rating — a snapshot, not a prediction or legal assessment"); the
// to-do list is his own; suggestions come from his saved record, nothing else.

import { FolderRatings } from "./FolderRatings";
import { FolderTodos } from "./FolderTodos";
import type { ChildInfo } from "./ChildFolder";

export type ProfilePatch = (profile: unknown) => void;

/** One shared POST-to-/api/auth/profile helper for both panels. The server
 *  merges into profile JSONB (weekRatings / todos) and returns the full
 *  profile; we hand it to home so its user state stays the source of truth. */
export async function patchProfile(
  body: Record<string, unknown>,
  onProfilePatch: ProfilePatch
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, error: typeof j?.error === "string" ? j.error : "Couldn't save that right now — please try again." };
    }
    onProfilePatch(j?.user?.profile);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save that right now — please try again." };
  }
}

export default function FolderOpenPanel({
  child,
  tier,
  profile,
  onProfilePatch,
  onGoLog,
  onGoAction,
}: {
  child: ChildInfo;
  tier: string;
  profile: unknown;
  onProfilePatch: ProfilePatch;
  onGoLog: () => void;
  onGoAction: () => void;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="card p-5">
        <FolderRatings
          child={child}
          tier={tier}
          profile={profile}
          onProfilePatch={onProfilePatch}
          onGoLog={onGoLog}
        />
      </div>
      <div className="card p-5">
        <FolderTodos
          child={child}
          tier={tier}
          profile={profile}
          onProfilePatch={onProfilePatch}
          onGoAction={onGoAction}
        />
      </div>
    </div>
  );
}
