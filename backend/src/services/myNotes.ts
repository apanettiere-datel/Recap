import type { MyNote, TranscriptSegment } from "../models/schema.js";

/**
 * Notes and bookmarks the recorder adds while recording ("my notes"). They tell the
 * analysis what the recorder cared about, and each one links to its moment in the audio.
 */

const MAX_NOTES = 300;
const MAX_TEXT = 1000;

/** Validate client-supplied notes; anything malformed is dropped rather than rejected. */
export function sanitizeMyNotes(raw: unknown): MyNote[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: MyNote[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_TEXT) : "";
    const mark = r.mark === true;
    if (!text && !mark) continue;
    const t = typeof r.t === "number" && Number.isFinite(r.t) && r.t >= 0 && r.t < 24 * 3600 ? Math.round(r.t * 10) / 10 : null;
    let id = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : "";
    if (!id || seen.has(id)) id = `n${out.length}_${Math.random().toString(36).slice(2, 8)}`;
    seen.add(id);
    out.push(mark ? { id, t, text, mark } : { id, t, text });
    if (out.length >= MAX_NOTES) break;
  }
  return out.sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** What was being said around a moment, so a bare bookmark still means something to the model. */
function around(segments: TranscriptSegment[], t: number, speakers: Record<string, string> | null | undefined) {
  const near = segments.filter((s) => s.e >= t - 20 && s.s <= t + 10);
  return near
    .map((s) => `${s.k ? `${speakers?.[s.k] ?? `Speaker ${s.k}`}: ` : ""}${s.t}`)
    .join(" ")
    .slice(0, 600);
}

/**
 * Instructions plus the notes themselves, for the analysis prompt. Empty when there
 * are no notes, so prompts are unchanged for recordings without any.
 */
export function myNotesPrompt(myNotes: MyNote[] | null | undefined, segments: TranscriptSegment[] | null | undefined, speakers?: Record<string, string> | null): string {
  if (!myNotes?.length) return "";
  const segs = segments ?? [];
  const lines = myNotes.slice(0, 80).map((n) => {
    const at = n.t != null ? `[${clock(n.t)}] ` : "";
    if (n.mark) {
      const context = n.t != null && segs.length ? around(segs, n.t, speakers) : "";
      return `- ${at}BOOKMARK${n.text ? `: ${n.text}` : ""}${context ? `\n  (being said: "${context}")` : ""}`;
    }
    return `- ${at}${n.text}`;
  });
  return `
## THE RECORDER'S OWN NOTES (IMPORTANT)
While recording, the person who recorded this typed notes and bookmarked moments. They show what mattered most to them:
- Make sure the summary covers every point in these notes, in the recorder's own terms.
- A note that reads like a to-do ("send pricing", "follow up w/ Sarah") is a commitment owned by "me" unless it clearly belongs to someone else.
- Bookmarked moments are important; prefer quotes from around them.
- The notes may be terse or abbreviated; use the transcript to understand them. Never contradict the transcript.
${lines.join("\n")}
`;
}

/** Plain text of the notes, for search passages and exports. */
export function myNotesText(myNotes: MyNote[] | null | undefined): string {
  if (!myNotes?.length) return "";
  return myNotes
    .map((n) => `${n.t != null ? `[${clock(n.t)}] ` : ""}${n.mark ? "Bookmark" : ""}${n.mark && n.text ? ": " : ""}${n.text}`)
    .join("\n");
}
