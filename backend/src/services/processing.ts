import OpenAI from "openai";
import { readFile, writeFile, mkdtemp, rm, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { notes, commitments, topics, people, notePeople, quotes, tags, type TranscriptSegment } from "../models/schema.js";
import { eq, and, lt, sql } from "drizzle-orm";
import { generateInsights } from "./insights.js";
import { hasFfmpeg, normalizeAndSplit, sniffAudioFormat, AudioDecodeError, CHUNK_DURATION_SECS } from "./audio.js";
import { getOpenAI, ProcessingError, withRetry, chatJSON } from "./ai.js";
import { users } from "../models/schema.js";
import { identifySpeakers, labeledTranscript, vocabularyPrompt, correctVocabulary, speakerLabels } from "./speakers.js";
import { findMeetingForRecording, linkMeetingAttendees, type CalendarEvent } from "./calendar.js";
import { indexNote } from "./semantic.js";
import { myNotesPrompt } from "./myNotes.js";
import { assignProjectsFromAnalysis, projectHints } from "./projects.js";

const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24MB (Whisper limit is 25MB)
const MAX_CONCURRENT_NOTES = 2;
const CHUNK_TRANSCRIBE_CONCURRENCY = 3;
// Above this length a transcript is analyzed in segments and then synthesized (map-reduce)
const MAP_REDUCE_THRESHOLD_CHARS = 60_000;
const MAP_SEGMENT_CHARS = 20_000;
const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  /** Names of the user's projects this conversation belongs to. */
  projects: string[];
}

type ChunkAnalysis = Omit<AnalysisResult, "title" | "sentiment" | "tags" | "projects">;

/** Extra context for the analysis prompt: the recorder's notes and their projects. */
interface AnalysisContext {
  myNotes: string;
  projects: { name: string; description: string }[];
}

function projectsPrompt(projects: AnalysisContext["projects"]): string {
  if (projects.length === 0) return "";
  return `
## PROJECTS
The recorder groups conversations into these projects:
${projects.map((p) => `- "${p.name}"${p.description ? `: ${p.description.slice(0, 300)}` : ""}`).join("\n")}
Add "projects": ["exact project names from this list"] to the JSON for the projects this conversation is clearly about. Use [] if none clearly fit — never guess.
`;
}

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
    let segments = note.segments ?? [];
    let speakers = note.speakers ?? null;
    const needsTranscription = !!note.audioUrl && !note.audioDeletedAt && (opts.retranscribe || !transcript.trim());

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const knownPeople = await db.select().from(people).where(eq(people.userId, userId));
    const humanNames = knownPeople.filter((p) => p.relationship !== "organization").map((p) => p.name);
    // User's custom terms first (they matter most), then people and organizations they know
    const vocabulary = [...new Set([...(user?.vocabulary ?? []), ...knownPeople.map((p) => p.name)])].slice(0, 200);

    // The calendar meeting this recording belongs to, if any: title and attendees help
    // name speakers and link people
    let meeting: CalendarEvent | null = null;
    try {
      meeting = await findMeetingForRecording(userId, note.recordedAt, note.duration);
    } catch (err) {
      console.warn("[processNote] meeting lookup failed:", (err as Error).message);
    }
    const attendeeNames = (meeting?.attendees ?? []).map((a) => a.name).filter(Boolean);

    if (needsTranscription) {
      const result = await transcribeAudio(note.audioUrl, (stage) => setStage(noteId, stage), { prompt: vocabularyPrompt(vocabulary) });
      transcript = result.transcript;
      segments = result.segments;

      if (vocabulary.length && transcript.trim()) {
        await setStage(noteId, "Checking names and terms");
        try {
          const corrected = await correctVocabulary(segments, transcript, vocabulary);
          segments = corrected.segments;
          transcript = corrected.transcript;
          if (corrected.replacements.length) console.log(`[processNote] ${noteId}: fixed ${corrected.replacements.length} term spelling(s)`);
        } catch (err) {
          console.warn("[processNote] vocabulary correction skipped:", (err as Error).message);
        }
      }

      speakers = null;
      if (speakerLabels(segments).length > 0) {
        await setStage(noteId, "Identifying speakers");
        try {
          speakers = await identifySpeakers(segments, { knownPeople: humanNames, attendees: attendeeNames, meetingTitle: meeting?.title });
        } catch (err) {
          console.warn("[processNote] speaker naming skipped:", (err as Error).message);
          speakers = Object.fromEntries(speakerLabels(segments).map((k, i) => [k, `Speaker ${i + 1}`]));
        }
      }

      const updates: Partial<typeof notes.$inferInsert> = {
        transcript,
        segments: segments.length > 0 ? segments : null,
        speakers,
      };
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

    if (meeting) {
      await db.update(notes).set({ calendarEventId: meeting.id, meetingTitle: meeting.title || null }).where(eq(notes.id, noteId));
    }

    await setStage(noteId, "Analyzing conversation");
    // With speaker labels the model knows who said what: better quotes and commitment owners
    const labeled = speakers && segments.some((s) => s.k)
      ? `(Each line starts with the speaker's name. "Me" is the person who recorded this; commitments made by Me have owner "me".${meeting ? ` This was the calendar meeting "${meeting.title}"${attendeeNames.length ? ` with ${attendeeNames.join(", ")}` : ""}.` : ""})\n${labeledTranscript(segments, speakers)}`
      : meeting
        ? `(This was the calendar meeting "${meeting.title}"${attendeeNames.length ? ` with ${attendeeNames.join(", ")}` : ""}.)\n${transcript}`
        : transcript;
    const peopleForAnalysis = [
      ...knownPeople,
      ...attendeeNames
        .filter((n) => !knownPeople.some((p) => p.name.toLowerCase() === n.toLowerCase()))
        .map((name) => ({ name, keywords: [] as string[], relationship: "meeting attendee" })),
    ];
    const context: AnalysisContext = {
      // Read fresh: notes can be edited while the audio is being transcribed
      myNotes: myNotesPrompt((await db.select({ myNotes: notes.myNotes }).from(notes).where(eq(notes.id, noteId)))[0]?.myNotes, segments, speakers),
      projects: await projectHints(userId).catch(() => []),
    };
    const analysis = labeled.length > MAP_REDUCE_THRESHOLD_CHARS
      ? await analyzeLongTranscript(labeled, note.conversationMode, peopleForAnalysis, context)
      : await analyzeTranscript(labeled, note.conversationMode, peopleForAnalysis, context);

    await setStage(noteId, "Saving results");
    await saveAnalysis(noteId, userId, note.recordedAt, analysis);
    await assignProjectsFromAnalysis(userId, noteId, analysis.projects)
      .catch((e) => console.warn("[processNote] project assignment failed:", (e as Error).message));

    if (meeting) {
      await linkMeetingAttendees(userId, noteId, meeting).catch((e) => console.warn("[processNote] linking attendees failed:", e));
    }
    // Search by meaning; never blocks the note from being ready
    indexNote(noteId).catch((e) => console.warn("[processNote] semantic indexing failed:", (e as Error).message));

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
  segments: TranscriptSegment[];
  durationSecs: number | null;
}

interface FileTranscript {
  text: string;
  segments: TranscriptSegment[];
}

/** Shift a chunk's segment times by where that chunk starts in the whole recording. */
function offsetSegments(segments: TranscriptSegment[], offset: number): TranscriptSegment[] {
  return segments.map((s) => ({ ...s, s: round2(s.s + offset), e: round2(s.e + offset) }));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function transcribeAudio(audioUrl: string, onStage: (stage: string) => Promise<void>, opts: { prompt?: string } = {}): Promise<TranscriptionResult> {
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
    let chunkDurations: (number | null)[] = [];
    let durationSecs: number | null = null;

    if (await hasFfmpeg()) {
      try {
        const prepared = await normalizeAndSplit(filePath, workDir);
        chunkPaths = prepared.chunkPaths;
        chunkDurations = prepared.chunkDurations;
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
      const result = cleanFileTranscript(await transcribeFile(filePath, `audio.${ext}`, mime, opts));
      return { transcript: result.text, segments: result.segments, durationSecs };
    }

    // Where each chunk starts, from measured durations (fall back to the nominal length)
    const offsets: number[] = [];
    let acc = 0;
    for (let i = 0; i < chunkPaths.length; i++) {
      offsets.push(acc);
      acc += chunkDurationsOrNominal(chunkDurations, i);
    }

    const total = chunkPaths.length;
    console.log(`[transcribe] ${total} chunk(s), ${durationSecs ? `${Math.round(durationSecs)}s` : "unknown duration"}`);
    await onStage(total > 1 ? `Transcribing audio (0 of ${total})` : "Transcribing audio");

    let done = 0;
    const results = await mapWithConcurrency(chunkPaths, CHUNK_TRANSCRIBE_CONCURRENCY, async (path, i) => {
      try {
        const result = cleanFileTranscript(await transcribeFile(path, `chunk_${i}.mp3`, "audio/mpeg", opts));
        done++;
        if (total > 1) await onStage(`Transcribing audio (${done} of ${total})`);
        // Speaker labels restart in each chunk; prefix them so "A" in part 1 ≠ "A" in part 2
        const segments = total > 1 ? result.segments.map((sg) => (sg.k ? { ...sg, k: `${i + 1}${sg.k}` } : sg)) : result.segments;
        return { text: result.text, segments: offsetSegments(segments, offsets[i]) };
      } catch (err) {
        if (total > 1 && err instanceof Error) err.message = `part ${i + 1} of ${total}: ${err.message}`;
        throw err;
      }
    });

    return {
      transcript: results.map((r) => r.text).filter(Boolean).join(" ").trim(),
      segments: results.flatMap((r) => r.segments),
      durationSecs,
    };
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

function chunkDurationsOrNominal(durations: (number | null)[], i: number) {
  return durations[i] ?? CHUNK_DURATION_SECS;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

const DIARIZE_MODEL = "gpt-4o-transcribe-diarize";
// Turned off for the rest of the process if the account can't use the diarizing model
let diarizeAvailable = process.env.DIARIZE !== "off";

interface DiarizedSegment {
  speaker?: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Transcribe one audio file. Tries the diarizing model first ("who said what");
 * falls back to Whisper — which also honours the vocabulary prompt — if that model
 * is unavailable or its result can't be used.
 */
async function transcribeFile(filePath: string, filename: string, mime: string, opts: { prompt?: string } = {}): Promise<FileTranscript> {
  const data = await readFile(filePath);

  if (diarizeAvailable) {
    try {
      const result = await withRetry(`diarize ${filename}`, async () => {
        const file = new File([data], filename, { type: mime });
        return await getOpenAI().audio.transcriptions.create(
          { model: DIARIZE_MODEL, file, response_format: "diarized_json", chunking_strategy: "auto" } as never,
          { maxRetries: 0 },
        ) as unknown as { text?: string; segments?: DiarizedSegment[] };
      });
      const segments = (result?.segments ?? [])
        .map((s) => ({
          s: round2(Number(s.start) || 0),
          e: round2(Number(s.end) || 0),
          t: String(s.text ?? "").trim(),
          k: String(s.speaker ?? "").trim().slice(0, 20) || undefined,
        }))
        .filter((s) => s.t);
      if (segments.length > 0 || !String(result?.text ?? "").trim()) {
        return { text: segments.map((s) => s.t).join(" "), segments };
      }
      console.warn("[transcribe] diarized result had text but no segments; using Whisper");
    } catch (err) {
      if (err instanceof OpenAI.APIError && [400, 403, 404].includes(err.status ?? 0)) {
        console.warn(`[transcribe] diarization unavailable (${err.status}: ${err.message}); using Whisper from now on`);
        diarizeAvailable = false;
      } else if (err instanceof OpenAI.APIError && err.status === 401) {
        throw err;
      } else {
        console.warn(`[transcribe] diarization failed (${(err as Error).message}); using Whisper for this file`);
      }
    }
  }

  // The SDK's own retries re-send an already-consumed multipart stream and hang, so
  // retry here with a fresh File each attempt instead.
  return withRetry(`transcribe ${filename}`, async () => {
    const file = new File([data], filename, { type: mime });
    const res = await getOpenAI().audio.transcriptions.create(
      {
        model: "whisper-1",
        file,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
      },
      { maxRetries: 0 },
    ) as unknown as { text?: string; segments?: WhisperSegment[] } | string;

    if (typeof res === "string") return { text: res, segments: [] };
    const segments = (res.segments ?? [])
      // Whisper's own "this was silence" signal — drops hallucinated filler on quiet audio
      .filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1))
      .map((s) => ({ s: round2(Number(s.start) || 0), e: round2(Number(s.end) || 0), t: String(s.text ?? "").trim() }))
      .filter((s) => s.t);
    const text = segments.length > 0 || res.segments ? segments.map((s) => s.t).join(" ") : String(res.text ?? "");
    return { text, segments };
  });
}

// Whisper tends to hallucinate these on silent audio
const SILENCE_HALLUCINATIONS = [
  /^(thank you|thanks)( (so much|very much))?( for watching| for listening)?[.!]*$/i,
  /^(you|bye|okay|\.+)[.!]*$/i,
  /^(please )?(like and )?subscribe[.!]*$/i,
];

function cleanFileTranscript(result: FileTranscript): FileTranscript {
  const t = (result.text || "").trim();
  if (t.length < 40 && SILENCE_HALLUCINATIONS.some((re) => re.test(t))) return { text: "", segments: [] };
  return { text: t, segments: result.segments };
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

/** Draft a follow-up email after a conversation. */
export async function draftFollowUp(input: {
  title: string;
  summary: string;
  transcript: string;
  recipients: string[];
  commitments: { description: string; owner: string; dueDate: Date | null; person: string | null }[];
  tone?: string;
}): Promise<{ subject: string; body: string }> {
  const commitmentsText = input.commitments.length
    ? input.commitments.map((c) => `- ${c.owner === "me" ? "I" : c.person || "They"} will ${c.description}${c.dueDate ? ` (by ${c.dueDate.toISOString().split("T")[0]})` : ""}`).join("\n")
    : "None recorded.";
  const raw = await chatJSON(
    "You write concise, natural follow-up emails after a conversation, in the first person as the person who recorded it. Respond with valid JSON.",
    `Write a follow-up email to ${input.recipients.length ? input.recipients.join(", ") : "the other people in the conversation"}.
Tone: ${input.tone || "friendly and professional"}.

Return JSON: { "subject": "short subject line", "body": "email body with greeting and sign-off placeholder [Your name]" }

Rules:
- Thank them briefly, recap the key points in 2-4 short bullet lines, and list agreed next steps with owners and dates.
- Only include facts from the conversation below. Never invent dates, numbers or promises.
- Keep it under 180 words. Plain text, no markdown headings.

Conversation: ${input.title}
Summary: ${input.summary}
Commitments:
${commitmentsText}

Transcript excerpt:
${input.transcript.slice(0, 12000)}`,
  );
  const subject = str(raw.subject, 200) || `Follow-up: ${input.title}`;
  const body = str(raw.body, 5000);
  if (!body) throw new ProcessingError("The draft came back empty. Please try again.");
  return { subject, body };
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

async function analyzeLongTranscript(transcript: string, mode: string, knownPeople: KnownPerson[], context: AnalysisContext): Promise<AnalysisResult> {
  const today = todayISO();
  const segments = splitTranscript(transcript, MAP_SEGMENT_CHARS);
  console.log(`[analyze] map phase: ${segments.length} segments`);

  const chunkAnalyses = await mapWithConcurrency(segments, 3, (segment, i) =>
    summarizeSegment(segment, i + 1, segments.length, mode, today),
  );

  console.log(`[analyze] reduce phase`);
  return synthesizeSegments(chunkAnalyses, mode, knownPeople, today, context);
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

async function synthesizeSegments(chunks: ChunkAnalysis[], mode: string, knownPeople: KnownPerson[], today: string, context: AnalysisContext): Promise<AnalysisResult> {
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
${context.myNotes}${projectsPrompt(context.projects)}
${chunksText}`,
  );
  return normalizeAnalysis(raw);
}

async function analyzeTranscript(transcript: string, mode: string, knownPeople: KnownPerson[], context: AnalysisContext): Promise<AnalysisResult> {
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
${context.myNotes}${projectsPrompt(context.projects)}
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
/** Placeholder names that must never become contacts. */
function isPlaceholderName(name: string) {
  const n = name.trim().toLowerCase();
  return SKIP_NAMES.has(n) || /^(speaker|voice|person|participant)\s*[a-z0-9]{0,3}$/.test(n);
}
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
  const people = uniqueStrings(arr(raw.people), 30).filter((p) => !isPlaceholderName(p));

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
    projects: uniqueStrings(arr(raw.projects), 5, 120),
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
  if (isPlaceholderName(key)) return null;
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

  if (!found && !normalized.includes(" ")) {
    // "Sarah" → the one contact named "Sarah …", if there's exactly one
    const byFirstName = await tx
      .select()
      .from(people)
      .where(and(
        eq(people.userId, userId),
        sql`lower(${people.name}) like ${`${key.replace(/[\\%_]/g, (ch) => `\\${ch}`)} %`}`,
        sql`${people.relationship} <> 'organization'`,
      ))
      .limit(2);
    if (byFirstName.length === 1) found = byFirstName[0];
  }

  if (!found) {
    [found] = await tx.insert(people).values({ userId, name: normalized }).returning();
  }

  cache.set(key, found);
  return found;
}
