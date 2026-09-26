import OpenAI from "openai";
import { readFile, writeFile, mkdtemp, rm, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { notes, commitments, topics, people, notePeople, quotes, tags } from "../models/schema.js";
import { eq, and, lt, sql } from "drizzle-orm";
import { generateInsights } from "./insights.js";
import { hasFfmpeg, normalizeAndSplit, sniffAudioFormat, AudioDecodeError } from "./audio.js";

const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24MB (Whisper limit is 25MB)
const MAX_CONCURRENT_NOTES = 2;
const CHUNK_TRANSCRIBE_CONCURRENCY = 3;
// Above this length a transcript is analyzed in segments and then synthesized (map-reduce)
const MAP_REDUCE_THRESHOLD_CHARS = 60_000;
const MAP_SEGMENT_CHARS = 20_000;
const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new ProcessingError("The transcription service is not configured (missing OPENAI_API_KEY).");
  }
  if (!openaiClient) {
    // The SDK retries 408/409/429/5xx and connection errors with exponential backoff
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 4,
      timeout: 5 * 60 * 1000,
    });
  }
  return openaiClient;
}

/** An error whose message is safe and useful to show to the user. */
class ProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}

type EntityType = "PERSON" | "ORGANIZATION" | "PHONE" | "DATE" | "EMAIL" | "LOCATION";
const ENTITY_TYPES: EntityType[] = ["PERSON", "ORGANIZATION", "PHONE", "DATE", "EMAIL", "LOCATION"];

interface Entity {
  type: EntityType;
  text: string;
  context?: string;
}

interface Commitment {
  description: string;
  owner: "me" | "them";
  due_date: string | null;
  person_name: string | null;
}

interface AnalysisResult {
  title: string;
  summary: string;
  sentiment: string;
  commitments: Commitment[];
  people: string[];
  topics: string[];
  tags: string[];
  quotes: { text: string; speaker: string }[];
  entities: Entity[];
}

type ChunkAnalysis = Omit<AnalysisResult, "title" | "sentiment" | "tags">;

type KnownPerson = { name: string; keywords: string[]; relationship: string };

// ---------------------------------------------------------------------------
// Queue — bounded concurrency, and a note is never processed twice at once
// ---------------------------------------------------------------------------

interface Job {
  noteId: string;
  userId: string;
  retranscribe: boolean;
}

const pending: Job[] = [];
const active = new Set<string>();

export function isNoteQueued(noteId: string): boolean {
  return active.has(noteId) || pending.some((j) => j.noteId === noteId);
}

/** Queue a note for processing. Returns false if it is already queued or running. */
export function enqueueNote(noteId: string, userId: string, opts: { retranscribe?: boolean } = {}): boolean {
  if (isNoteQueued(noteId)) return false;
  pending.push({ noteId, userId, retranscribe: opts.retranscribe ?? false });
  drainQueue();
  return true;
}

function drainQueue() {
  while (active.size < MAX_CONCURRENT_NOTES && pending.length > 0) {
    const job = pending.shift()!;
    active.add(job.noteId);
    processNote(job.noteId, job.userId, { retranscribe: job.retranscribe })
      .catch((e) => console.error(`[queue] note ${job.noteId} crashed:`, e))
      .finally(() => {
        active.delete(job.noteId);
        drainQueue();
      });
  }
}

/**
 * Notes left with is_processing=true were interrupted (server restart, crash, deploy).
 * Re-queue recent ones and fail old ones so nothing spins forever.
 */
export async function recoverInterruptedProcessing() {
  const stuck = await db
    .select({ id: notes.id, userId: notes.userId, createdAt: notes.createdAt })
    .from(notes)
    .where(eq(notes.isProcessing, true));

  if (stuck.length === 0) return;
  console.log(`[recovery] found ${stuck.length} note(s) interrupted mid-processing`);

  const cutoff = Date.now() - RECOVERY_MAX_AGE_MS;
  for (const note of stuck) {
    if (note.createdAt.getTime() < cutoff) {
      await setFailed(note.id, "Processing was interrupted. Tap Retry to process this recording again.");
    } else {
      enqueueNote(note.id, note.userId);
    }
  }
}

/** Notes whose processing started long ago but are not in this process's queue are orphaned. */
export async function failOrphanedProcessing(maxAgeMs = 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.isProcessing, true), lt(notes.processingStartedAt, cutoff)));
  for (const n of stale) {
    if (!isNoteQueued(n.id)) {
      await setFailed(n.id, "Processing timed out. Tap Retry to try again.");
    }
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function setStage(noteId: string, stage: string) {
  await db.update(notes).set({ processingStage: stage }).where(eq(notes.id, noteId));
}

async function setFailed(noteId: string, message: string) {
  await db
    .update(notes)
    .set({ isProcessing: false, processingStage: null, processingError: message })
    .where(eq(notes.id, noteId));
}

export async function processNote(noteId: string, userId: string, opts: { retranscribe?: boolean } = {}) {
  const started = Date.now();
  try {
    const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
    if (!note) return;

    await db
      .update(notes)
      .set({
        isProcessing: true,
        processingError: null,
        processingStage: "Preparing audio",
        processingStartedAt: new Date(),
      })
      .where(eq(notes.id, noteId));

    let transcript = note.transcript ?? "";
    const needsTranscription = !!note.audioUrl && (opts.retranscribe || !transcript.trim());

    if (needsTranscription) {
      const result = await transcribeAudio(note.audioUrl, (stage) => setStage(noteId, stage));
      transcript = result.transcript;

      const updates: Partial<typeof notes.$inferInsert> = { transcript };
      // Recovered or interrupted recordings may not know their duration — trust the decoder
      if (result.durationSecs && (!note.duration || Math.abs(note.duration - result.durationSecs) > 5)) {
        updates.duration = Math.round(result.durationSecs);
      }
      // Persist immediately so an analysis failure doesn't cost a re-transcription
      await db.update(notes).set(updates).where(eq(notes.id, noteId));
    }

    if (!transcript.trim()) {
      await db
        .update(notes)
        .set({
          title: note.title || "Silent recording",
          summary: "No speech was detected in this recording. Check that your microphone was working and not muted.",
          sentiment: "neutral",
          isProcessing: false,
          processingStage: null,
          processingError: null,
        })
        .where(eq(notes.id, noteId));
      console.log(`[processNote] ${noteId}: no speech detected`);
      return;
    }

    await setStage(noteId, "Analyzing conversation");
    const knownPeople = await db.select().from(people).where(eq(people.userId, userId));
    const analysis = transcript.length > MAP_REDUCE_THRESHOLD_CHARS
      ? await analyzeLongTranscript(transcript, note.conversationMode, knownPeople)
      : await analyzeTranscript(transcript, note.conversationMode, knownPeople);

    await setStage(noteId, "Saving results");
    await saveAnalysis(noteId, userId, note.recordedAt, analysis);

    console.log(`[processNote] ${noteId}: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    generateInsights(userId).catch((e) => console.error("[processNote] insights generation failed:", e));
  } catch (error) {
    console.error(`[processNote] ${noteId} failed:`, error);
    await setFailed(noteId, describeError(error)).catch((e) =>
      console.error(`[processNote] could not record failure for ${noteId}:`, e),
    );
  }
}

/** Turn any failure into a message the user can act on. */
function describeError(error: unknown): string {
  if (error instanceof ProcessingError || error instanceof AudioDecodeError) {
    return error instanceof AudioDecodeError
      ? "The audio couldn't be decoded. The recording may have been corrupted when it was interrupted."
      : error.message;
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) return "The transcription service rejected our credentials. Please contact support.";
    if (error.status === 429) {
      return /quota/i.test(error.message)
        ? "The transcription service quota has been exceeded. Please try again later."
        : "The transcription service is busy. Please retry in a few minutes.";
    }
    if (error.status === 400 || error.status === 413) {
      return /format|decode|invalid|corrupt/i.test(error.message)
        ? "The audio format wasn't accepted. The recording may be corrupted or empty."
        : `The transcription service rejected the recording: ${error.message}`;
    }
    if (error.status && error.status >= 500) return "The transcription service had a temporary problem. Please retry.";
  }
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.APIConnectionTimeoutError) {
    return "Couldn't reach the transcription service. Please retry.";
  }
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "The audio file for this recording is missing on the server.";
  const message = error instanceof Error ? error.message : String(error);
  return message ? `Processing failed: ${message}` : "Processing failed for an unknown reason.";
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

interface TranscriptionResult {
  transcript: string;
  durationSecs: number | null;
}

async function transcribeAudio(audioUrl: string, onStage: (stage: string) => Promise<void>): Promise<TranscriptionResult> {
  const workDir = await mkdtemp(join(tmpdir(), "recap-audio-"));
  try {
    let filePath: string;
    if (audioUrl.startsWith("file://")) {
      filePath = fileURLToPath(audioUrl);
    } else {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new ProcessingError(`Couldn't download the audio (HTTP ${response.status}).`);
      filePath = join(workDir, "source");
      await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    }

    const { size } = await stat(filePath);
    if (size < 1024) throw new ProcessingError("The recording is empty — no audio was captured.");

    let chunkPaths: string[] | null = null;
    let durationSecs: number | null = null;

    if (await hasFfmpeg()) {
      try {
        const prepared = await normalizeAndSplit(filePath, workDir);
        chunkPaths = prepared.chunkPaths;
        durationSecs = prepared.durationSecs;
      } catch (err) {
        // Fall through to sending the original file, Whisper may still accept it
        if (size > WHISPER_MAX_BYTES) throw err;
        console.warn("[transcribe] normalization failed, trying the original file:", (err as Error).message);
      }
    }

    if (!chunkPaths) {
      if (size > WHISPER_MAX_BYTES) {
        throw new ProcessingError("This recording is too large to process on this server (audio tools unavailable).");
      }
      await onStage("Transcribing audio");
      const header = await readHeader(filePath);
      const { ext, mime } = sniffAudioFormat(header);
      const transcript = await transcribeFile(filePath, `audio.${ext}`, mime);
      return { transcript: cleanTranscript(transcript), durationSecs };
    }

    const total = chunkPaths.length;
    console.log(`[transcribe] ${total} chunk(s), ${durationSecs ? `${Math.round(durationSecs)}s` : "unknown duration"}`);
    await onStage(total > 1 ? `Transcribing audio (0 of ${total})` : "Transcribing audio");

    let done = 0;
    const results = await mapWithConcurrency(chunkPaths, CHUNK_TRANSCRIBE_CONCURRENCY, async (path, i) => {
      try {
        const text = await transcribeFile(path, `chunk_${i}.mp3`, "audio/mpeg");
        done++;
        if (total > 1) await onStage(`Transcribing audio (${done} of ${total})`);
        return cleanTranscript(text);
      } catch (err) {
        if (total > 1 && err instanceof Error) err.message = `part ${i + 1} of ${total}: ${err.message}`;
        throw err;
      }
    });

    return { transcript: results.filter(Boolean).join(" ").trim(), durationSecs };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readHeader(filePath: string): Promise<Uint8Array> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

async function transcribeFile(filePath: string, filename: string, mime: string): Promise<string> {
  const data = await readFile(filePath);
  // The SDK's own retries re-send an already-consumed multipart stream and hang, so
  // retry here with a fresh File each attempt instead.
  return withRetry(`transcribe ${filename}`, async () => {
    const file = new File([data], filename, { type: mime });
    const transcription = await getOpenAI().audio.transcriptions.create(
      { model: "whisper-1", file, response_format: "text" },
      { maxRetries: 0 },
    );
    return typeof transcription === "string" ? transcription : String((transcription as { text?: string }).text ?? "");
  });
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true; // includes timeouts
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    if (status === 429) return !/quota/i.test(err.message);
    return status === 408 || status === 409 || status >= 500;
  }
  return false;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isRetryable(err)) throw err;
      const delay = Math.round(Math.min(1000 * 2 ** i, 20_000) * (0.75 + Math.random() * 0.5));
      console.warn(`[retry] ${label} failed (${(err as Error).message}); attempt ${i + 2}/${attempts} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Whisper tends to hallucinate these on silent audio
const SILENCE_HALLUCINATIONS = [
  /^(thank you|thanks)( (so much|very much))?( for watching| for listening)?[.!]*$/i,
  /^(you|bye|okay|\.+)[.!]*$/i,
  /^(please )?(like and )?subscribe[.!]*$/i,
];

function cleanTranscript(text: string): string {
  const t = (text || "").trim();
  if (t.length < 40 && SILENCE_HALLUCINATIONS.some((re) => re.test(t))) return "";
  return t;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function chatJSON(system: string, user: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = response.choices[0]?.message?.content;
    try {
      if (!content) throw new Error("empty response");
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") return parsed;
      throw new Error("response was not an object");
    } catch (err) {
      lastError = err;
      console.warn(`[analyze] invalid JSON from model (attempt ${attempt + 1}):`, (err as Error).message);
    }
  }
  throw new ProcessingError(`Analysis returned an unreadable result (${(lastError as Error)?.message}). Please retry.`);
}

function knownPeopleContext(knownPeople: KnownPerson[]): string {
  if (knownPeople.length === 0) return "";
  return `\n## KNOWN PEOPLE (use these exact names when you recognize them):
${knownPeople.map((p) => `- "${p.name}"${p.relationship ? ` (${p.relationship})` : ""}${p.keywords?.length > 0 ? ` — keywords/aliases: ${p.keywords.join(", ")}` : ""}`).join("\n")}\n`;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

/** Split text into pieces of roughly maxChars, preferring sentence boundaries. */
function splitTranscript(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > maxChars && current) {
      pieces.push(current.trim());
      current = "";
    }
    // A single enormous "sentence" (no punctuation) gets hard-split
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) pieces.push(s.slice(i, i + maxChars).trim());
      continue;
    }
    current += s;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

async function analyzeLongTranscript(transcript: string, mode: string, knownPeople: KnownPerson[]): Promise<AnalysisResult> {
  const today = todayISO();
  const segments = splitTranscript(transcript, MAP_SEGMENT_CHARS);
  console.log(`[analyze] map phase: ${segments.length} segments`);

  const chunkAnalyses = await mapWithConcurrency(segments, 3, (segment, i) =>
    summarizeSegment(segment, i + 1, segments.length, mode, today),
  );

  console.log(`[analyze] reduce phase`);
  return synthesizeSegments(chunkAnalyses, mode, knownPeople, today);
}

async function summarizeSegment(transcript: string, n: number, total: number, mode: string, today: string): Promise<ChunkAnalysis> {
  const raw = await chatJSON(
    "You extract structured data from a segment of a longer conversation transcript. Always respond with valid JSON.",
    `This is segment ${n} of ${total} from a longer recording (mode: ${mode}).
Today's date is ${today}.

Extract the following as JSON:
{
  "summary": "2-3 sentence summary of what was discussed in THIS segment",
  "commitments": [{ "description": "...", "owner": "me or them", "due_date": "ISO date or null", "person_name": "who this involves or null" }],
  "people": ["person names mentioned (humans only, not companies)"],
  "topics": ["specific topics discussed, max 5"],
  "quotes": [{ "text": "notable quote", "speaker": "person name" }],
  "entities": [{ "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "...", "context": "..." }]
}

Rules:
- Only real commitments, not vague intentions
- Convert relative dates to absolute dates based on ${today}
- "me"/"I" = the recorder, never include in people array
- Max 2 quotes per segment
- People array = humans only, organizations go in entities

Transcript segment:
${transcript}`,
  );
  const a = normalizeAnalysis(raw);
  return { summary: a.summary, commitments: a.commitments, people: a.people, topics: a.topics, quotes: a.quotes, entities: a.entities };
}

async function synthesizeSegments(chunks: ChunkAnalysis[], mode: string, knownPeople: KnownPerson[], today: string): Promise<AnalysisResult> {
  const chunksText = chunks.map((c, i) => `### Segment ${i + 1}
Summary: ${c.summary}
People: ${c.people.join(", ") || "none"}
Topics: ${c.topics.join(", ") || "none"}
Commitments: ${c.commitments.length > 0 ? c.commitments.map((cm) => `${cm.description} (${cm.owner}${cm.person_name ? `, ${cm.person_name}` : ""}${cm.due_date ? `, due ${cm.due_date}` : ""})`).join("; ") : "none"}
Quotes: ${c.quotes.length > 0 ? c.quotes.map((q) => `"${q.text}" — ${q.speaker}`).join("; ") : "none"}
Entities: ${c.entities.length > 0 ? c.entities.map((e) => `${e.type}: ${e.text}`).join("; ") : "none"}`).join("\n\n");

  const raw = await chatJSON(
    "You synthesize segment-level analyses of a long conversation into one cohesive final analysis. Deduplicate people, merge related topics, and keep only the most important quotes and commitments across the entire conversation. Always respond with valid JSON.",
    `Below are analyses of ${chunks.length} consecutive segments from a long recording (mode: ${mode}).
Today's date is ${today}.
${knownPeopleContext(knownPeople)}
Synthesize them into ONE final analysis as JSON:
{
  "title": "Short title for the entire conversation (max 8 words)",
  "summary": "3-5 sentence summary covering the full conversation arc",
  "sentiment": "overall sentiment: positive, negative, neutral, tense, excited, cautious",
  "commitments": [{ "description": "...", "owner": "me or them", "due_date": "ISO date or null", "person_name": "who this involves or null" }],
  "people": ["deduplicated list of all people mentioned (humans only)"],
  "topics": ["merged key topics across all segments, max 7"],
  "tags": ["3-5 short labels for categorizing this conversation"],
  "quotes": [{ "text": "most notable quote", "speaker": "person name" }],
  "entities": [{ "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "...", "context": "..." }]
}

Rules:
- Deduplicate people who appear in multiple segments
- Merge related/overlapping topics into broader ones
- Keep only the 3 most important quotes across ALL segments
- Include ALL commitments (don't drop any)
- Deduplicate entities but keep all unique ones
- Match people names to known people when possible
- The summary should tell the story of the whole conversation, not just list segment summaries

${chunksText}`,
  );
  return normalizeAnalysis(raw);
}

async function analyzeTranscript(transcript: string, mode: string, knownPeople: KnownPerson[]): Promise<AnalysisResult> {
  const modeInstructions: Record<string, string> = {
    general: "Extract commitments, people, topics, and notable quotes.",
    "1-on-1": "Focus on commitments between two people and relationship dynamics. Track who owes what.",
    "team_meeting": "Focus on action items, decisions made, and who is responsible for each.",
    interview: "Extract questions asked, key answers, and candidate/interviewer impressions.",
    brainstorm: "Capture ideas proposed (as topics) rather than commitments. Note who proposed each idea.",
    sales_call: "Track objections raised, next steps, deal signals, and competitive mentions.",
  };

  const today = todayISO();

  const prompt = `Analyze this conversation transcript. Mode: ${mode}.
TODAY'S DATE: ${today}
${modeInstructions[mode] || modeInstructions.general}
${knownPeopleContext(knownPeople)}
Return JSON with this exact structure:
{
  "title": "Short title (max 8 words)",
  "summary": "2-3 sentence summary",
  "sentiment": "one word: positive, negative, neutral, tense, excited, cautious",
  "commitments": [
    { "description": "What was promised", "owner": "me or them", "due_date": "ISO date or null", "person_name": "who this commitment involves or null" }
  ],
  "people": ["Only actual PERSON names mentioned"],
  "topics": ["Key topics discussed, max 5, be specific"],
  "tags": ["3-5 short labels for categorizing this note, e.g. 'sales', 'follow-up', 'planning', 'hiring'"],
  "quotes": [
    { "text": "Notable or important quote", "speaker": "Person name" }
  ],
  "entities": [
    { "type": "PERSON|ORGANIZATION|PHONE|DATE|EMAIL|LOCATION", "text": "the entity", "context": "brief context of how it was mentioned" }
  ]
}

## DATE HANDLING (CRITICAL)
Today's date is ${today}. When someone says a relative date, convert it to an absolute ISO date:
- "next week" → the Monday of next week from ${today}
- "tomorrow" → the day after ${today}
- "end of month" → the last day of the current month
- "next Friday" → the next upcoming Friday from ${today}
- If a date is ambiguous or too vague to resolve, use null instead of guessing
- NEVER return dates in the past unless the speaker explicitly mentioned a past date

## ENTITY DETECTION (MANDATORY — never return empty)
You MUST identify ALL entities spoken in the transcript:
- PERSON: Every person name, nickname, or title ("Gary", "mom", "Dr. Smith")
- ORGANIZATION: Company names, brands, services ("Datel Software Solutions", "Starbucks")
- PHONE: Any phone numbers mentioned
- EMAIL: Any email addresses mentioned
- DATE: Any dates, times, or scheduling references ("tomorrow at 12:30", "next Tuesday")
- LOCATION: Places mentioned ("Oregon", "the office")

## PEOPLE vs ORGANIZATIONS (CRITICAL)
The "people" array must ONLY contain actual human beings — never companies, brands, or services.
- People: "Gary", "mom", "Dr. Smith", "Sarah from accounting"
- NOT people (put these ONLY in entities with type ORGANIZATION): "Rev.io", "DataGate", "Datel Software Solutions", "Google"
- If someone is called "mom", "dad", "bro" etc., use that as their name unless you can match to a known person above

## RULES
- "me" = the person recording (first person). NEVER include "me", "myself", "I" in the people array.
- "them" = anyone else
- Only extract REAL commitments — actual promises, action items, or agreements. NOT vague intentions, hypotheticals, or pleasantries.
- Only extract genuinely notable quotes, max 3
- Topics should be specific ("Oregon flight booking" not "travel")
- For people: use the known person's exact name if detected by name or keywords.
- For commitments: set person_name to the specific person the commitment involves.

Transcript:
${transcript}`;

  const raw = await chatJSON(
    "You are a conversation intelligence engine. You extract structured data, entities, and relationships from conversation transcripts. Always respond with valid JSON. Be thorough with entity detection — every name, number, date, and organization matters.",
    prompt,
  );
  return normalizeAnalysis(raw);
}

// ---------------------------------------------------------------------------
// Validation — model output is untrusted; bad values used to crash DB inserts
// ---------------------------------------------------------------------------

const SKIP_NAMES = new Set(["unknown", "me", "myself", "i", "the user", "user", "speaker", "recorder", "narrator", "you", ""]);
const SENTIMENTS = new Set(["positive", "negative", "neutral", "tense", "excited", "cautious", "mixed"]);

function str(v: unknown, max = 2000): string {
  if (typeof v === "string") return v.trim().slice(0, max);
  if (typeof v === "number") return String(v);
  return "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function uniqueStrings(values: unknown[], max: number, maxLen = 200): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = str(v, maxLen);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Accept only real calendar dates in a sane range; anything else becomes null. */
function parseDueDate(v: unknown): string | null {
  const s = str(v, 40);
  if (!s || /^(null|none|n\/a|unknown|tbd)$/i.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return d.toISOString();
}

function normalizeAnalysis(raw: Record<string, unknown>): AnalysisResult {
  const people = uniqueStrings(arr(raw.people), 30).filter((p) => !SKIP_NAMES.has(p.toLowerCase()));

  const commitments: Commitment[] = arr(raw.commitments)
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : { description: c }))
    .map((c) => ({
      description: str(c.description, 1000),
      owner: (str(c.owner).toLowerCase() === "them" ? "them" : "me") as "me" | "them",
      due_date: parseDueDate(c.due_date),
      person_name: str(c.person_name, 200) || null,
    }))
    .filter((c) => c.description)
    .slice(0, 50);

  const quotes = arr(raw.quotes)
    .map((q) => (q && typeof q === "object" ? (q as Record<string, unknown>) : { text: q }))
    .map((q) => ({ text: str(q.text, 1000), speaker: str(q.speaker, 200) || "Unknown" }))
    .filter((q) => q.text)
    .slice(0, 10);

  const entities: Entity[] = arr(raw.entities)
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      type: str(e.type).toUpperCase() as EntityType,
      text: str(e.text, 300),
      context: str(e.context, 500) || undefined,
    }))
    .filter((e) => e.text && ENTITY_TYPES.includes(e.type))
    .slice(0, 100);

  const sentiment = str(raw.sentiment, 40).toLowerCase().split(/[\s,]/)[0];

  return {
    title: str(raw.title, 200) || "Untitled conversation",
    summary: str(raw.summary, 5000),
    sentiment: SENTIMENTS.has(sentiment) ? sentiment : "neutral",
    commitments,
    people,
    topics: uniqueStrings(arr(raw.topics), 10),
    tags: uniqueStrings(arr(raw.tags), 8, 50),
    quotes,
    entities,
  };
}

// ---------------------------------------------------------------------------
// Persistence — one transaction, and safe to re-run (reprocessing never duplicates)
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Person = typeof people.$inferSelect;

async function saveAnalysis(noteId: string, userId: string, recordedAt: Date, analysis: AnalysisResult) {
  await db.transaction(async (tx) => {
    const personCache = new Map<string, Person | null>();
    const person = (name: string | null) => (name ? findOrCreatePerson(tx, userId, name, personCache) : Promise.resolve(null));

    // Clear previously derived data so a reprocess replaces rather than duplicates
    await tx.delete(topics).where(eq(topics.noteId, noteId));
    await tx.delete(quotes).where(eq(quotes.noteId, noteId));
    await tx.delete(commitments).where(eq(commitments.noteId, noteId));

    for (const c of analysis.commitments) {
      const p = await person(c.person_name || analysis.people[0] || null);
      await tx.insert(commitments).values({
        userId,
        noteId,
        personId: p?.id,
        description: c.description,
        owner: c.owner,
        dueDate: c.due_date ? new Date(c.due_date) : null,
      });
    }

    if (analysis.topics.length > 0) {
      await tx.insert(topics).values(analysis.topics.map((label) => ({ noteId, label })));
    }

    // Keep tags the user added; only add labels that aren't already there
    const existingTags = await tx.select({ label: tags.label }).from(tags).where(eq(tags.noteId, noteId));
    const existingLabels = new Set(existingTags.map((t) => t.label.toLowerCase()));
    const newTags = analysis.tags.filter((label) => !existingLabels.has(label.toLowerCase()));
    if (newTags.length > 0) {
      await tx.insert(tags).values(newTags.map((label) => ({ userId, noteId, label })));
    }

    for (const q of analysis.quotes) {
      const p = await person(q.speaker);
      await tx.insert(quotes).values({ noteId, personId: p?.id, text: q.text, speaker: q.speaker });
    }

    const linked = new Set(
      (await tx.select({ personId: notePeople.personId }).from(notePeople).where(eq(notePeople.noteId, noteId)))
        .map((r) => r.personId),
    );
    const link = async (personId: string) => {
      if (linked.has(personId)) return;
      linked.add(personId);
      await tx.insert(notePeople).values({ noteId, personId });
    };

    for (const name of analysis.people) {
      const p = await person(name);
      if (!p) continue;
      await link(p.id);
      await tx.update(people).set({ lastContactDate: recordedAt }).where(eq(people.id, p.id));
    }

    await enrichPeopleFromEntities(tx, userId, analysis.entities, analysis.people, person, link);

    await tx
      .update(notes)
      .set({
        title: analysis.title,
        summary: analysis.summary,
        sentiment: analysis.sentiment,
        isProcessing: false,
        processingStage: null,
        processingError: null,
      })
      .where(eq(notes.id, noteId));
  });
}

async function enrichPeopleFromEntities(
  tx: Tx,
  userId: string,
  entities: Entity[],
  personNames: string[],
  person: (name: string | null) => Promise<Person | null>,
  link: (personId: string) => Promise<void>,
) {
  if (entities.length === 0) return;

  const phones = entities.filter((e) => e.type === "PHONE");
  const emails = entities.filter((e) => e.type === "EMAIL");
  const orgs = entities.filter((e) => e.type === "ORGANIZATION");

  // With exactly one person in the conversation, contact details almost certainly belong to them
  if (personNames.length === 1) {
    const p = await person(personNames[0]);
    if (p) {
      const updates: Record<string, string> = {};
      if (phones.length > 0 && !p.phone) updates.phone = phones[0].text;
      if (emails.length > 0 && !p.email) updates.email = emails[0].text;
      if (orgs.length > 0 && !p.organization) updates.organization = orgs[0].text;
      if (Object.keys(updates).length > 0) {
        await tx.update(people).set(updates).where(eq(people.id, p.id));
        Object.assign(p, updates);
      }
    }
  }

  for (const org of orgs) {
    const orgName = org.text.trim();
    if (!orgName) continue;

    for (const name of personNames) {
      const p = await person(name);
      if (p && !p.organization) {
        await tx.update(people).set({ organization: orgName }).where(eq(people.id, p.id));
        p.organization = orgName;
      }
    }

    // Organizations are tracked as entities (people rows with relationship "organization")
    let [orgEntry] = await tx
      .select()
      .from(people)
      .where(and(eq(people.userId, userId), sql`lower(${people.name}) = ${orgName.toLowerCase()}`))
      .limit(1);
    if (!orgEntry) {
      [orgEntry] = await tx
        .insert(people)
        .values({ userId, name: orgName, relationship: "organization", organization: orgName })
        .returning();
    }
    if (orgEntry) await link(orgEntry.id);
  }
}

async function findOrCreatePerson(tx: Tx, userId: string, name: string, cache: Map<string, Person | null>): Promise<Person | null> {
  const normalized = name.trim();
  const key = normalized.toLowerCase();
  if (SKIP_NAMES.has(key)) return null;
  if (cache.has(key)) return cache.get(key)!;

  const [exact] = await tx
    .select()
    .from(people)
    .where(and(eq(people.userId, userId), sql`lower(${people.name}) = ${key}`))
    .limit(1);

  let found: Person | null = exact ?? null;

  if (!found) {
    const [byKeyword] = await tx
      .select()
      .from(people)
      .where(and(
        eq(people.userId, userId),
        sql`exists (select 1 from unnest(${people.keywords}) k where lower(k) = ${key})`,
      ))
      .limit(1);
    found = byKeyword ?? null;
  }

  if (!found) {
    [found] = await tx.insert(people).values({ userId, name: normalized }).returning();
  }

  cache.set(key, found);
  return found;
}
