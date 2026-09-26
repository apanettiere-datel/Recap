import type { TranscriptSegment } from "../models/schema.js";
import { chatJSON } from "./ai.js";

/**
 * Speaker naming and custom vocabulary.
 *
 * The diarizing transcriber labels voices ("A", "B"; per audio chunk "1A", "2B"),
 * but not who they are. We show the model a sample of what each voice said, plus
 * known people and meeting attendees, and ask it to name them. "Me" is the person
 * who recorded.
 */

export const ME = "Me";

export function speakerLabels(segments: TranscriptSegment[]): string[] {
  return [...new Set(segments.map((s) => s.k).filter((k): k is string => !!k))];
}

export async function identifySpeakers(
  segments: TranscriptSegment[],
  context: { knownPeople: string[]; attendees: string[]; meetingTitle?: string | null },
): Promise<Record<string, string>> {
  const labels = speakerLabels(segments);
  if (labels.length === 0) return {};

  const samples = labels.map((label) => {
    const said = segments.filter((s) => s.k === label);
    const words = said.reduce((n, s) => n + s.t.split(/\s+/).length, 0);
    const lines = said.slice(0, 8).map((s) => `  - ${s.t.slice(0, 200)}`).join("\n");
    return `Speaker ${label} (${words} words):\n${lines}`;
  });

  // Show a little back-and-forth so the model can see who addresses whom by name
  const exchange = segments.slice(0, 40).map((s) => `${s.k ?? "?"}: ${s.t.slice(0, 160)}`).join("\n");

  const raw = await chatJSON(
    "You identify the speakers in a diarized conversation transcript. Respond with valid JSON.",
    `Identify who each speaker label is.
- The person who made the recording must be named exactly "${ME}". Usually the recorder is the one who is addressed by others, or who talks about "my" plans; if unsure, pick the most talkative speaker.
- Use real names only when the conversation makes them clear (someone is addressed by name, introduces themselves, or matches a known person/attendee). Otherwise use "Speaker 2", "Speaker 3", etc.
- Labels that start with different numbers come from different parts of one recording; the same person can appear under several labels — give them the same name.
${context.meetingTitle ? `Meeting: ${context.meetingTitle}\n` : ""}${context.attendees.length ? `Meeting attendees: ${context.attendees.join(", ")}\n` : ""}${context.knownPeople.length ? `People the recorder knows: ${context.knownPeople.slice(0, 60).join(", ")}\n` : ""}
Return JSON: { "speakers": { "<label>": "<name>" } } with every label: ${labels.join(", ")}

${samples.join("\n\n")}

Opening of the conversation:
${exchange}`,
  );

  const out: Record<string, string> = {};
  const given = (raw.speakers && typeof raw.speakers === "object" ? raw.speakers : {}) as Record<string, unknown>;
  let unknown = 2;
  for (const label of labels) {
    const name = typeof given[label] === "string" ? (given[label] as string).trim().slice(0, 80) : "";
    out[label] = name || `Speaker ${unknown++}`;
  }
  // Exactly the recorder is "Me"; if the model named nobody "Me", leave labels as they are
  return out;
}

/** "Me: …\nSarah: …" with consecutive lines from one speaker merged. */
export function labeledTranscript(segments: TranscriptSegment[], speakers: Record<string, string> | null | undefined): string {
  if (!speakers || !segments.some((s) => s.k)) return segments.map((s) => s.t).join(" ");
  const lines: string[] = [];
  let current = "";
  let buf: string[] = [];
  for (const seg of segments) {
    const name = seg.k ? speakers[seg.k] ?? `Speaker ${seg.k}` : "Unknown";
    if (name !== current && buf.length) {
      lines.push(`${current}: ${buf.join(" ")}`);
      buf = [];
    }
    current = name;
    buf.push(seg.t);
  }
  if (buf.length) lines.push(`${current}: ${buf.join(" ")}`);
  return lines.join("\n");
}

/** Whisper's prompt nudges spelling; keep it within its ~224-token window. */
export function vocabularyPrompt(vocabulary: string[]): string | undefined {
  if (vocabulary.length === 0) return undefined;
  let prompt = "Names and terms: ";
  for (const term of vocabulary) {
    if ((prompt + term).length > 700) break;
    prompt += `${term}, `;
  }
  return prompt.replace(/, $/, ".");
}

function squash(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** A replacement must plausibly be a mishearing of the term ("Data Gate" → "DataGate"), never a different word. */
function looksLike(from: string, to: string) {
  const a = squash(from);
  const b = squash(to);
  if (!a || !b) return false;
  if (a === b) return true;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length) >= 0.6;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fix misspellings of the user's vocabulary (e.g. "Data Gate" → "DataGate").
 * The model only proposes replacements; we apply them ourselves, and only when the
 * target is one of the user's terms, so nothing else in the transcript can change.
 */
export async function correctVocabulary(
  segments: TranscriptSegment[],
  transcript: string,
  vocabulary: string[],
): Promise<{ segments: TranscriptSegment[]; transcript: string; replacements: { from: string; to: string }[] }> {
  if (vocabulary.length === 0 || !transcript.trim()) return { segments, transcript, replacements: [] };

  const raw = await chatJSON(
    "You find misspelled names and terms in speech-to-text output. Respond with valid JSON.",
    `These are the correct spellings of names and terms that may appear in the transcript:
${vocabulary.slice(0, 200).join(", ")}

List every place the transcript contains a mis-transcribed version of one of these terms (wrong spelling, split or merged words, wrong capitalization of a proper name). Only include clear matches for the listed terms — never "correct" ordinary words.

Return JSON: { "replacements": [{ "from": "exact text as it appears in the transcript", "to": "correct term from the list" }] }

Transcript:
${transcript.slice(0, 40000)}`,
  );

  const allowed = new Map(vocabulary.map((v) => [v.toLowerCase(), v]));
  const replacements = (Array.isArray(raw.replacements) ? raw.replacements : [])
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
    .map((r) => ({ from: String(r.from ?? "").trim(), to: allowed.get(String(r.to ?? "").trim().toLowerCase()) ?? "" }))
    .filter((r) => r.from.length >= 3 && r.to && r.from !== r.to && transcript.includes(r.from) && looksLike(r.from, r.to))
    .slice(0, 100);

  if (replacements.length === 0) return { segments, transcript, replacements };

  const apply = (text: string) =>
    replacements.reduce((t, r) => t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(r.from)}(?![\\p{L}\\p{N}])`, "gu"), r.to), text);

  return {
    segments: segments.map((s) => ({ ...s, t: apply(s.t) })),
    transcript: apply(transcript),
    replacements,
  };
}
