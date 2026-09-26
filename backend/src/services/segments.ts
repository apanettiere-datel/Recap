import type { TranscriptSegment } from "../models/schema.js";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** When (in seconds) a quote was said, by matching its opening words to timed segments. */
export function findQuoteTime(quote: string, segments: TranscriptSegment[] | null | undefined): number | null {
  if (!quote || !segments?.length) return null;
  const words = norm(quote).split(" ");
  for (const len of [6, 4, 3]) {
    if (words.length < len) continue;
    const probe = words.slice(0, len).join(" ");
    const hit = segments.find((seg) => norm(seg.t).includes(probe));
    if (hit) return hit.s;
  }
  const probe = words.slice(0, 4).join(" ");
  for (let i = 0; i < segments.length - 1; i++) {
    if (norm(`${segments[i].t} ${segments[i + 1].t}`).includes(probe)) return segments[i].s;
  }
  return null;
}
