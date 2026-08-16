// FolderTodos — the To-Do paper in the opened child's folder (Design 1).
// "{Name}'s list": manual one-line items (add / tap-to-complete / remove /
// Clear done), real cap 20 OPEN items per child, text <= 120 chars. Below it,
// read-only "From your Action Center" suggestions filtered to items whose text
// mentions the child's name (client-side; section hidden entirely when nothing
// matches — no fake empty state; 402 on lower tiers hides it silently).
// Honesty footer: "Your own list — suggestions come from your saved record,
// nothing else."

import { useCallback, useEffect, useMemo, useState } from "react";
import { track } from "~/lib/analytics";
import { fetchActionCenter, type ActionItem } from "~/lib/actionCenter";
import { patchProfile, type ProfilePatch } from "./FolderOpenPanel";
import type { ChildInfo } from "./ChildFolder";

const OPEN_CAP = 20;
const TEXT_CAP = 120;
const SECTIONS: Record<string, string> = {
  unresolved: "Unresolved",
  upcoming: "Upcoming",
  missing: "Missing",
  needs_documentation: "Needs documentation",
};

export type TodoItem = { id: string; text: string; done: boolean; createdAt: string };

export function FolderTodos({
  child,
  tier,
  profile,
  onProfilePatch,
  onGoAction,
}: {
  child: ChildInfo;
  tier: string;
  profile: unknown;
  onProfilePatch: ProfilePatch;
  onGoAction: () => void;
}) {
  const childId = child.id || child.name;
  const profileObj = (profile || {}) as Record<string, unknown>;
  const items: TodoItem[] = (((profileObj.todos as Record<string, TodoItem[]> | undefined) || {})[childId] || []).slice(0, 40);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const openCount = items.filter((i) => !i.done).length;
  const doneCount = items.length - openCount;

  // Action Center suggestions — mention-match on the child's name; a fetch
  // failure or 402 (lower tiers) just hides the section (no dead end).
  const [suggestions, setSuggestions] = useState<ActionItem[] | null>(null);
  const loadSuggestions = useCallback(async () => {
    try {
      const r = await fetchActionCenter();
      if (r.ok && r.value.summary) {
        setSuggestions(r.value.summary.items || []);
      } else {
        setSuggestions([]);
      }
    } catch {
      setSuggestions([]);
    }
  }, []);
  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);
  const nameMatches = useMemo(() => {
    if (!suggestions) return null;
    const n = child.name.trim().toLowerCase();
    if (!n) return [];
    return suggestions.filter((s) => s.text.toLowerCase().includes(n));
  }, [suggestions, child.name]);

  async function save(next: TodoItem[]) {
    setBusy(true);
    setErr("");
    const res = await patchProfile({ todos: next, todosChild: childId }, onProfilePatch);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    return res.ok;
  }

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    if (openCount >= OPEN_CAP) return;
    const next: TodoItem[] = [...items, { id: crypto.randomUUID(), text: text.slice(0, TEXT_CAP), done: false, createdAt: new Date().toISOString() }];
    if (await save(next)) {
      track("folder_todo_add", { plan: tier });
      setDraft("");
    }
  }

  async function toggle(id: string) {
    if (busy) return;
    const next = items.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    if (await save(next)) track("folder_todo_toggle", { plan: tier });
  }

  async function remove(id: string) {
    if (busy) return;
    const next = items.filter((i) => i.id !== id);
    if (await save(next)) track("folder_todo_delete", { plan: tier });
  }

  async function clearDone() {
    if (busy || doneCount === 0) return;
    const next = items.filter((i) => !i.done);
    if (await save(next)) track("folder_todo_clear_done", { plan: tier });
  }

  const atCap = openCount >= OPEN_CAP;

  return (
    <section className="flex h-full flex-col">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">To-Do</p>
      <h3 className="mt-1 font-display text-2xl font-semibold leading-snug text-forest">
        {child.name}'s list — small things, one at a time.
      </h3>

      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="sr-only" htmlFor={`todo-add-${childId}`}>One thing to do for {child.name}</label>
        <input
          id={`todo-add-${childId}`}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setErr("");
          }}
          maxLength={TEXT_CAP}
          placeholder={`One thing to do for ${child.name}…`}
          className="min-h-12 w-full flex-1 rounded-xl border border-line bg-cream px-5 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
        />
        <button type="submit" disabled={!draft.trim() || busy || atCap} className="btn-primary shrink-0 px-5">
          Add
        </button>
      </form>
      {atCap && (
        <p className="mt-2 text-sm text-stone">20 open items — that's the list's limit.</p>
      )}
      {err && <p role="alert" className="mt-2 text-base text-red-800">{err}</p>}

      {items.length === 0 ? (
        <p className="mt-4 text-base leading-relaxed text-ink">
          Nothing on the list. Add one small thing — one line is all it takes.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-line bg-card px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(i.id)}
                disabled={busy}
                aria-pressed={i.done}
                aria-label={i.done ? `Mark "${i.text}" as to do` : `Mark "${i.text}" done`}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${i.done ? "border-forest bg-forest text-cream" : "border-forest-soft/60 bg-cream text-transparent"}`}
              >
                ✓
              </button>
              <span className={`min-w-0 flex-1 text-base leading-relaxed ${i.done ? "text-stone line-through" : "text-ink"}`}>
                {i.text}
              </span>
              {i.done && <span className="shrink-0 rounded-full bg-forest/10 px-2.5 py-0.5 text-xs font-semibold text-forest">Done</span>}
              <button
                type="button"
                onClick={() => remove(i.id)}
                disabled={busy}
                aria-label={`Remove ${i.text}`}
                className="icon-btn min-h-11 min-w-11 shrink-0 text-stone"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {doneCount > 0 && (
        <button type="button" onClick={clearDone} disabled={busy} className="mt-3 min-h-11 self-start text-base text-forest underline underline-offset-4">
          Clear done
        </button>
      )}

      {/* Suggestions — hidden entirely when nothing matches (honest). */}
      {nameMatches && nameMatches.length > 0 && (
        <div className="mt-5 rounded-2xl border border-forest/20 bg-cream-deep/50 p-4">
          <p className="text-base font-semibold text-forest">From your Action Center</p>
          <p className="mt-1 text-sm leading-relaxed text-stone">Things your record is watching for {child.name}.</p>
          <div className="mt-3 space-y-2">
            {nameMatches.slice(0, 4).map((s) => (
              <div key={s.id} className="rounded-xl border border-line bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-forest-soft">{SECTIONS[s.section] || s.section}</p>
                <p className="mt-1 text-base leading-relaxed text-ink">{s.text}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              track("folder_action_suggestion_tap", { plan: tier });
              onGoAction();
            }}
            className="mt-3 min-h-11 text-base font-semibold text-forest underline underline-offset-4"
          >
            Open Action Center →
          </button>
        </div>
      )}

      <p className="mt-auto pt-4 text-sm leading-relaxed text-stone">
        Your own list — suggestions come from your saved record, nothing else.
      </p>
    </section>
  );
}
