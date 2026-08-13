// FolderOpenPanel — the opened child's folder body (owner batch 2, Design 1).
// NOT a modal, NOT a bottom sheet: an in-flow surface rendered directly under
// the folder scene, with two "papers" lying in the folder — Ratings (Exchange
// Tone) and To-Do. Mobile stacks them; sm+ shows them side by side. Both
// papers stay fully interactive while the fixed open-folder bar pins above.
//
// Honesty rails: the rating is the dad's OWN self-report ("your record and
// your own rating — a snapshot, not a prediction or legal assessment"); the
// to-do list is his own; suggestions come from his saved record, nothing else.

import { FolderRatings } from "./FolderRatings";
import { FolderTodos } from "./FolderTodos";
import type { ChildInfo } from "./ChildFolder";

export type ProfilePatch = (profile: unknown) => void;

/** One shared POST-to-/api/auth/profile helper for both papers. The server
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
    <div className="child-folder-open-body">
      <div className="folder-paper">
        <FolderRatings
          child={child}
          tier={tier}
          profile={profile}
          onProfilePatch={onProfilePatch}
          onGoLog={onGoLog}
        />
      </div>
      <div className="folder-paper">
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
