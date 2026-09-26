import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import { zipSync, strToU8 } from "fflate";
import { db } from "./db.js";
import {
  calendarEvents, commitments, insights, noteProjects, notePeople, notes, people, projects, quotes, shares, tags, topics, users, weeklyReports,
  type MyNote, type TranscriptSegment,
} from "../models/schema.js";

/**
 * Conversation exports (Markdown, Word, PDF) and the "download all my data" archive.
 * Every format is built from the same plain document model, so they always agree.
 */

export interface ExportNote {
  id: string;
  title: string;
  recordedAt: Date;
  duration: number;
  meetingTitle: string | null;
  summary: string;
  sentiment: string;
  people: string[];
  projects: string[];
  topics: string[];
  tags: string[];
  commitments: { description: string; owner: "me" | "them"; personName: string | null; dueDate: Date | null; status: string }[];
  quotes: { text: string; speaker: string }[];
  myNotes: MyNote[];
  transcript: string;
  segments: TranscriptSegment[];
  speakers: Record<string, string>;
}

export async function loadExportNotes(userId: string, noteIds?: string[]): Promise<ExportNote[]> {
  const rows = await db
    .select()
    .from(notes)
    .where(noteIds ? and(eq(notes.userId, userId), inArray(notes.id, noteIds)) : eq(notes.userId, userId))
    .orderBy(desc(notes.recordedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((n) => n.id);

  const [cRows, tRows, pRows, qRows, tagRows, prRows] = await Promise.all([
    db.select({ c: commitments, personName: people.name }).from(commitments).leftJoin(people, eq(commitments.personId, people.id))
      .where(inArray(commitments.noteId, ids)).orderBy(asc(commitments.createdAt)),
    db.select().from(topics).where(inArray(topics.noteId, ids)),
    db.select({ noteId: notePeople.noteId, name: people.name }).from(notePeople).innerJoin(people, eq(notePeople.personId, people.id))
      .where(inArray(notePeople.noteId, ids)),
    db.select().from(quotes).where(inArray(quotes.noteId, ids)),
    db.select().from(tags).where(inArray(tags.noteId, ids)),
    db.select({ noteId: noteProjects.noteId, name: projects.name }).from(noteProjects).innerJoin(projects, eq(noteProjects.projectId, projects.id))
      .where(inArray(noteProjects.noteId, ids)),
  ]);

  const pick = <R extends { noteId: string | null }>(list: R[], id: string) => list.filter((r) => r.noteId === id);
  return rows.map((n) => ({
    id: n.id,
    title: n.title || "Untitled conversation",
    recordedAt: n.recordedAt,
    duration: n.duration,
    meetingTitle: n.meetingTitle,
    summary: n.summary,
    sentiment: n.sentiment,
    people: [...new Set(pick(pRows, n.id).map((p) => p.name))],
    projects: [...new Set(pick(prRows, n.id).map((p) => p.name))],
    topics: pick(tRows, n.id).map((t) => t.label),
    tags: pick(tagRows, n.id).map((t) => t.label),
    commitments: cRows.filter((r) => r.c.noteId === n.id).map((r) => ({
      description: r.c.description, owner: r.c.owner, personName: r.personName, dueDate: r.c.dueDate, status: r.c.status,
    })),
    quotes: pick(qRows, n.id).map((q) => ({ text: q.text, speaker: q.speaker })),
    myNotes: n.myNotes ?? [],
    transcript: n.transcript,
    segments: n.segments ?? [],
    speakers: n.speakers ?? {},
  }));
}

// ---------------------------------------------------------------------------
// Shared document model
// ---------------------------------------------------------------------------

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function longDate(d: Date, timeZone: string) {
  try {
    return d.toLocaleString("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return d.toUTCString();
  }
}

function shortDate(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

function durationText(secs: number) {
  if (!secs) return "";
  const m = Math.round(secs / 60);
  return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Transcript as speaker turns: consecutive segments from one speaker are merged. */
export function transcriptTurns(n: Pick<ExportNote, "segments" | "speakers" | "transcript">): { speaker: string | null; start: number | null; text: string }[] {
  if (!n.segments.length) return n.transcript.trim() ? [{ speaker: null, start: null, text: n.transcript.trim() }] : [];
  const turns: { speaker: string | null; start: number | null; text: string }[] = [];
  for (const seg of n.segments) {
    const speaker = seg.k ? n.speakers[seg.k] ?? `Speaker ${seg.k}` : null;
    const last = turns[turns.length - 1];
    // Without speakers, start a new paragraph about every 30 seconds so timestamps stay useful
    if (last && last.speaker === speaker && (speaker || seg.s - (last.start ?? 0) < 30)) last.text += ` ${seg.t}`;
    else turns.push({ speaker, start: seg.s, text: seg.t });
  }
  return turns;
}

type Block =
  | { kind: "h1"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "bullet"; text: string; checked?: boolean }
  | { kind: "quote"; text: string; by?: string }
  | { kind: "turn"; label: string; text: string };

function blocksFor(n: ExportNote, opts: { transcript: boolean; timeZone: string }): Block[] {
  const b: Block[] = [{ kind: "h1", text: n.title }];
  const meta = [longDate(n.recordedAt, opts.timeZone), durationText(n.duration), n.meetingTitle ? `Meeting: ${n.meetingTitle}` : ""].filter(Boolean).join(" · ");
  b.push({ kind: "meta", text: meta });
  const withLine = [n.people.length ? `With: ${n.people.join(", ")}` : "", n.projects.length ? `Project: ${n.projects.join(", ")}` : ""].filter(Boolean).join(" · ");
  if (withLine) b.push({ kind: "meta", text: withLine });

  if (n.summary.trim()) b.push({ kind: "h2", text: "Summary" }, { kind: "p", text: n.summary.trim() });

  if (n.commitments.length) {
    b.push({ kind: "h2", text: "Action items" });
    for (const c of n.commitments) {
      const who = c.owner === "me" ? "Me" : c.personName || "Them";
      b.push({ kind: "bullet", checked: c.status === "completed", text: `${c.description} — ${who}${c.dueDate ? `, due ${shortDate(c.dueDate)}` : ""}` });
    }
  }

  if (n.myNotes.length) {
    b.push({ kind: "h2", text: "My notes" });
    for (const m of n.myNotes) {
      b.push({ kind: "bullet", text: `${m.t != null ? `[${clock(m.t)}] ` : ""}${m.mark ? "Bookmark" : ""}${m.mark && m.text ? ": " : ""}${m.text}` });
    }
  }

  if (n.quotes.length) {
    b.push({ kind: "h2", text: "Key quotes" });
    for (const q of n.quotes) b.push({ kind: "quote", text: q.text, by: q.speaker });
  }

  if (n.topics.length) b.push({ kind: "h2", text: "Topics" }, { kind: "p", text: n.topics.join(" · ") });

  if (opts.transcript) {
    const turns = transcriptTurns(n);
    if (turns.length) {
      b.push({ kind: "h2", text: "Transcript" });
      for (const t of turns) {
        const label = [t.start != null ? `[${clock(t.start)}]` : "", t.speaker ?? ""].filter(Boolean).join(" ");
        b.push({ kind: "turn", label, text: t.text });
      }
    }
  }
  return b;
}

export function safeFilename(title: string, ext: string) {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "conversation";
  return `${base}.${ext}`;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Escape what would change the meaning of plain text in Markdown (emphasis, code, HTML, headings). */
function mdEscape(s: string) {
  return s.replace(/([\\`*_<>])/g, "\\$1").replace(/^(\s*)([#>+-])(?=\s)/gm, "$1\\$2");
}

export function toMarkdown(n: ExportNote, opts: { transcript: boolean; timeZone: string }): string {
  const out: string[] = [];
  let inList = false;
  for (const block of blocksFor(n, opts)) {
    // A list needs a blank line after it
    if (inList && block.kind !== "bullet") out.push("");
    inList = block.kind === "bullet";
    switch (block.kind) {
      case "h1": out.push(`# ${mdEscape(block.text)}`, ""); break;
      case "meta": out.push(`*${mdEscape(block.text)}*`, ""); break;
      case "h2": out.push(`## ${block.text}`, ""); break;
      case "p": out.push(mdEscape(block.text), ""); break;
      case "bullet": out.push(block.checked === undefined ? `- ${mdEscape(block.text)}` : `- [${block.checked ? "x" : " "}] ${mdEscape(block.text)}`); break;
      case "quote": out.push(`> “${mdEscape(block.text)}”${block.by ? ` — ${mdEscape(block.by)}` : ""}`, ""); break;
      case "turn": out.push(`${block.label ? `**${mdEscape(block.label)}:** ` : ""}${mdEscape(block.text)}`, ""); break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

export async function toDocx(n: ExportNote, opts: { transcript: boolean; timeZone: string }): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const block of blocksFor(n, opts)) {
    switch (block.kind) {
      case "h1": children.push(new Paragraph({ text: block.text, heading: HeadingLevel.TITLE })); break;
      case "meta": children.push(new Paragraph({ children: [new TextRun({ text: block.text, color: "666666", size: 20 })] })); break;
      case "h2": children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2, spacing: { before: 280 } })); break;
      case "p": children.push(new Paragraph({ text: block.text, spacing: { after: 120 } })); break;
      case "bullet":
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: `${block.checked === undefined ? "" : block.checked ? "☑ " : "☐ "}${block.text}`, strike: !!block.checked, color: block.checked ? "888888" : undefined })],
        }));
        break;
      case "quote":
        children.push(new Paragraph({
          indent: { left: 400 },
          spacing: { after: 120 },
          children: [new TextRun({ text: `“${block.text}”`, italics: true }), ...(block.by ? [new TextRun({ text: ` — ${block.by}`, color: "666666" })] : [])],
        }));
        break;
      case "turn":
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [...(block.label ? [new TextRun({ text: `${block.label}: `, bold: true })] : []), new TextRun({ text: block.text })],
        }));
        break;
    }
  }
  const doc = new Document({
    creator: "Recap",
    title: n.title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * The built-in PDF fonts only cover Western European characters. Map the common
 * typographic ones and drop anything else rather than printing garbage.
 */
function pdfSafe(s: string) {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .normalize("NFC")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF\u2022\u20AC]/g, (ch) => {
      const base = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      return /^[\x20-\x7E]+$/.test(base) ? base : "";
    });
}

export function toPdf(n: ExportNote, opts: { transcript: boolean; timeZone: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 60, bottom: 60, left: 64, right: 64 }, info: { Title: pdfSafe(n.title), Creator: "Recap" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - 128;
    for (const block of blocksFor(n, opts)) {
      switch (block.kind) {
        case "h1":
          doc.font("Helvetica-Bold").fontSize(20).fillColor("#111111").text(pdfSafe(block.text), { width });
          doc.moveDown(0.3);
          break;
        case "meta":
          doc.font("Helvetica").fontSize(10).fillColor("#666666").text(pdfSafe(block.text), { width });
          break;
        case "h2":
          doc.moveDown(1);
          doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(pdfSafe(block.text), { width });
          doc.moveDown(0.3);
          break;
        case "p":
          doc.font("Helvetica").fontSize(11).fillColor("#222222").text(pdfSafe(block.text), { width, lineGap: 2 });
          doc.moveDown(0.4);
          break;
        case "bullet": {
          const prefix = block.checked === undefined ? "•  " : block.checked ? "[x]  " : "[  ]  ";
          doc.font("Helvetica").fontSize(11).fillColor(block.checked ? "#888888" : "#222222")
            .text(pdfSafe(prefix + block.text), { width, indent: 0, lineGap: 2 });
          doc.moveDown(0.2);
          break;
        }
        case "quote":
          doc.font("Helvetica-Oblique").fontSize(11).fillColor("#333333").text(pdfSafe(`"${block.text}"`), 80, undefined, { width: width - 16, lineGap: 2 });
          if (block.by) doc.font("Helvetica").fontSize(9).fillColor("#777777").text(pdfSafe(`- ${block.by}`), 80, undefined, { width: width - 16 });
          doc.x = 64;
          doc.moveDown(0.4);
          break;
        case "turn":
          doc.fontSize(10.5).fillColor("#222222");
          if (block.label) doc.font("Helvetica-Bold").text(pdfSafe(`${block.label}: `), { continued: true, width, lineGap: 2 });
          doc.font("Helvetica").text(pdfSafe(block.text), { width, lineGap: 2 });
          doc.moveDown(0.35);
          break;
      }
    }
    doc.moveDown(2);
    doc.font("Helvetica").fontSize(8).fillColor("#999999").text("Exported from Recap", { width });
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Everything, as a ZIP: data.json (machine-readable) + one Markdown file per conversation
// ---------------------------------------------------------------------------

export async function buildDataArchive(userId: string): Promise<Uint8Array> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const tz = user?.timezone || "UTC";
  const all = await loadExportNotes(userId);
  const [peopleRows, commitmentRows, projectRows, insightRows, reportRows, shareRows, eventRows] = await Promise.all([
    db.select().from(people).where(eq(people.userId, userId)),
    db.select().from(commitments).where(eq(commitments.userId, userId)),
    db.select().from(projects).where(eq(projects.userId, userId)),
    db.select().from(insights).where(eq(insights.userId, userId)),
    db.select().from(weeklyReports).where(eq(weeklyReports.userId, userId)),
    db.select({ id: shares.id, noteId: shares.noteId, includeAudio: shares.includeAudio, includeTranscript: shares.includeTranscript, views: shares.views, createdAt: shares.createdAt, revokedAt: shares.revokedAt })
      .from(shares).where(eq(shares.userId, userId)),
    db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId)),
  ]);
  const projectLinks = projectRows.length
    ? await db.select().from(noteProjects).where(inArray(noteProjects.projectId, projectRows.map((p) => p.id)))
    : [];

  const account = user && {
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone,
    createdAt: user.createdAt,
    vocabulary: user.vocabulary,
    settings: {
      weeklyEmail: { enabled: user.digestEnabled, email: user.digestEmail, day: user.digestDay, hour: user.digestHour },
      reminders: { enabled: user.remindersEnabled, hour: user.reminderHour },
      calendarConnected: !!user.calendarIcsUrl,
      audioRetentionDays: user.audioRetentionDays,
      todoistConnected: !!user.todoistToken,
      notionConnected: !!user.notionToken,
    },
  };

  const data = {
    exportedAt: new Date().toISOString(),
    format: "recap-export-v1",
    account,
    conversations: all,
    people: peopleRows.map(({ userId: _u, ...p }) => p),
    commitments: commitmentRows.map(({ userId: _u, ...c }) => c),
    projects: projectRows.map(({ userId: _u, ...p }) => ({ ...p, conversationIds: projectLinks.filter((l) => l.projectId === p.id).map((l) => l.noteId) })),
    insights: insightRows.map(({ userId: _u, ...i }) => i),
    weeklyReports: reportRows.map(({ userId: _u, ...r }) => r),
    shareLinks: shareRows,
    calendarEvents: eventRows.map(({ userId: _u, ...e }) => e),
  };

  const files: Record<string, Uint8Array> = {
    "README.txt": strToU8(`Your Recap data, exported ${new Date().toUTCString()}.

data.json       Everything in machine-readable form: conversations (with full
                transcripts and your notes), people, commitments, projects,
                insights, weekly reports, share links and calendar events.
conversations/  Each conversation as a Markdown file, readable in any text
                editor or importable into Notion, Obsidian, etc.

Audio recordings are not included (they can be very large). Download a
recording's audio from its page in Recap.
`),
    "data.json": strToU8(JSON.stringify(data, null, 2)),
  };
  const used = new Set<string>();
  for (const n of all) {
    const day = n.recordedAt.toISOString().slice(0, 10);
    let name = `conversations/${day} ${safeFilename(n.title, "md")}`;
    for (let i = 2; used.has(name); i++) name = `conversations/${day} ${safeFilename(`${n.title} ${i}`, "md")}`;
    used.add(name);
    files[name] = strToU8(toMarkdown(n, { transcript: true, timeZone: tz }));
  }
  return zipSync(files, { level: 6 });
}
