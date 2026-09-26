import type { ExportNote } from "./export.js";
import { clock, transcriptTurns } from "./export.js";

/**
 * Sending things out of Recap: action items to Todoist, conversations to Notion.
 * Both use a personal token the user pastes in Settings (no OAuth app needed).
 */

export class IntegrationError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const TODOIST_BASE = process.env.TODOIST_API_BASE || "https://api.todoist.com";
const NOTION_BASE = process.env.NOTION_API_BASE || "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 20000;

async function call(url: string, init: RequestInit & { service: string }) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new IntegrationError(`Couldn't reach ${init.service}. Please try again.`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data };
}

// ---------------------------------------------------------------------------
// Todoist
// ---------------------------------------------------------------------------

function todoistHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Check a token works; returns the number of projects (just to prove access). */
export async function verifyTodoist(token: string) {
  // API v1, with the older REST v2 as a fallback
  for (const path of ["/api/v1/projects", "/rest/v2/projects"]) {
    const { res } = await call(`${TODOIST_BASE}${path}`, { headers: todoistHeaders(token), service: "Todoist" });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) throw new IntegrationError("Todoist didn't accept that token. Copy it again from Todoist → Settings → Integrations → Developer.", 400);
    if (res.status !== 404 && res.status !== 410) throw new IntegrationError(`Todoist returned an error (${res.status}). Please try again.`);
  }
  throw new IntegrationError("Couldn't connect to Todoist.");
}

export async function addTodoistTask(token: string, task: { content: string; description?: string; dueDate?: Date | null }) {
  const body = {
    content: task.content.slice(0, 500),
    description: task.description?.slice(0, 16000),
    ...(task.dueDate ? { due_date: task.dueDate.toISOString().slice(0, 10) } : {}),
  };
  for (const path of ["/api/v1/tasks", "/rest/v2/tasks"]) {
    const { res, data } = await call(`${TODOIST_BASE}${path}`, {
      method: "POST",
      headers: todoistHeaders(token),
      body: JSON.stringify(body),
      service: "Todoist",
    });
    if (res.ok) {
      const d = (data ?? {}) as { id?: string | number; url?: string };
      const id = d.id != null ? String(d.id) : "";
      return { id, url: d.url || (id ? `https://app.todoist.com/app/task/${id}` : "https://app.todoist.com") };
    }
    if (res.status === 401 || res.status === 403) throw new IntegrationError("Todoist rejected the saved token. Reconnect Todoist in Settings.", 401);
    if (res.status !== 404 && res.status !== 410) throw new IntegrationError(`Todoist returned an error (${res.status}). Please try again.`);
  }
  throw new IntegrationError("Couldn't create the task in Todoist.");
}

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

function notionHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };
}

/** Accept a Notion page URL or a bare page ID; return the ID with dashes. */
export function parseNotionPageId(input: string): string | null {
  const clean = input.trim().split(/[?#]/)[0];
  const m = clean.replace(/-/g, "").match(/([0-9a-f]{32})$/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function notionError(status: number, data: unknown): IntegrationError {
  const message = (data as { message?: string })?.message;
  if (status === 401) return new IntegrationError("Notion didn't accept that token. Copy the integration secret again from notion.so/my-integrations.", 400);
  if (status === 404) return new IntegrationError("Notion can't see that page. Open the page in Notion, choose ••• → Connections, and add your Recap integration.", 400);
  return new IntegrationError(`Notion returned an error${message ? `: ${message}` : ` (${status})`}.`);
}

/** Check the token can see the page; returns the page title. */
export async function verifyNotion(token: string, pageId: string): Promise<string> {
  const { res, data } = await call(`${NOTION_BASE}/v1/pages/${pageId}`, { headers: notionHeaders(token), service: "Notion" });
  if (!res.ok) throw notionError(res.status, data);
  const props = ((data as { properties?: Record<string, { type?: string; title?: { plain_text?: string }[] }> })?.properties) ?? {};
  const titleProp = Object.values(props).find((p) => p?.type === "title");
  return titleProp?.title?.map((t) => t.plain_text ?? "").join("") || "Untitled page";
}

type RichText = { type: "text"; text: { content: string }; annotations?: Record<string, boolean> };

/** Notion caps each text object at 2000 characters. */
function rich(text: string, annotations?: Record<string, boolean>): RichText[] {
  const out: RichText[] = [];
  for (let i = 0; i < text.length || (i === 0 && out.length === 0); i += 2000) {
    out.push({ type: "text", text: { content: text.slice(i, i + 2000) }, ...(annotations ? { annotations } : {}) });
    if (!text.length) break;
  }
  return out.slice(0, 90);
}

function block(type: string, content: Record<string, unknown>) {
  return { object: "block", type, [type]: content };
}

function notionBlocks(n: ExportNote, withTranscript: boolean) {
  const blocks: unknown[] = [];
  const meta = [
    n.recordedAt.toUTCString().replace(" GMT", " UTC"),
    n.people.length ? `With ${n.people.join(", ")}` : "",
    n.projects.length ? `Project: ${n.projects.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  blocks.push(block("paragraph", { rich_text: rich(meta, { italic: true }) }));
  if (n.summary.trim()) {
    blocks.push(block("heading_2", { rich_text: rich("Summary") }), block("paragraph", { rich_text: rich(n.summary.trim()) }));
  }
  if (n.commitments.length) {
    blocks.push(block("heading_2", { rich_text: rich("Action items") }));
    for (const c of n.commitments) {
      const who = c.owner === "me" ? "Me" : c.personName || "Them";
      const due = c.dueDate ? `, due ${c.dueDate.toISOString().slice(0, 10)}` : "";
      blocks.push(block("to_do", { rich_text: rich(`${c.description} — ${who}${due}`), checked: c.status === "completed" }));
    }
  }
  if (n.myNotes.length) {
    blocks.push(block("heading_2", { rich_text: rich("My notes") }));
    for (const m of n.myNotes) {
      blocks.push(block("bulleted_list_item", { rich_text: rich(`${m.t != null ? `[${clock(m.t)}] ` : ""}${m.mark ? "Bookmark" : ""}${m.mark && m.text ? ": " : ""}${m.text}`) }));
    }
  }
  if (n.quotes.length) {
    blocks.push(block("heading_2", { rich_text: rich("Key quotes") }));
    for (const q of n.quotes) blocks.push(block("quote", { rich_text: rich(`“${q.text}”${q.speaker ? ` — ${q.speaker}` : ""}`) }));
  }
  if (n.topics.length) {
    blocks.push(block("heading_2", { rich_text: rich("Topics") }), block("paragraph", { rich_text: rich(n.topics.join(" · ")) }));
  }
  if (withTranscript) {
    const turns = transcriptTurns(n);
    if (turns.length) {
      blocks.push(block("heading_2", { rich_text: rich("Transcript") }));
      for (const t of turns) {
        const label = [t.start != null ? `[${clock(t.start)}]` : "", t.speaker ?? ""].filter(Boolean).join(" ");
        blocks.push(block("paragraph", { rich_text: [...(label ? rich(`${label}: `, { bold: true }) : []), ...rich(t.text)] }));
      }
    }
  }
  return blocks;
}

/** Create a page for the conversation under the user's chosen parent page. */
export async function createNotionPage(token: string, parentId: string, n: ExportNote, withTranscript: boolean): Promise<string> {
  const blocks = notionBlocks(n, withTranscript);
  // A page can be created with at most 100 blocks; the rest are appended in batches
  const { res, data } = await call(`${NOTION_BASE}/v1/pages`, {
    method: "POST",
    headers: notionHeaders(token),
    service: "Notion",
    body: JSON.stringify({
      parent: { page_id: parentId },
      icon: { type: "emoji", emoji: "🎙️" },
      properties: { title: { title: rich(n.title.slice(0, 200)) } },
      children: blocks.slice(0, 100),
    }),
  });
  if (!res.ok) throw notionError(res.status, data);
  const page = data as { id: string; url?: string };
  for (let i = 100; i < blocks.length && i < 2000; i += 100) {
    const r = await call(`${NOTION_BASE}/v1/blocks/${page.id}/children`, {
      method: "PATCH",
      headers: notionHeaders(token),
      service: "Notion",
      body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
    });
    if (!r.res.ok) {
      console.warn(`[notion] appending blocks failed (${r.res.status}); page is partial`);
      break;
    }
  }
  return page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`;
}
