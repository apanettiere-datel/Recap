import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email. Configure ONE of:
 *   RESEND_API_KEY=re_...                       (https://resend.com)
 *   SMTP_URL=smtps://user:pass@smtp.host:465    (any SMTP provider, e.g. Gmail app password, SES, Postmark)
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS [/ SMTP_SECURE=true]
 * and EMAIL_FROM="Recap <recap@yourdomain.com>".
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery isn't set up on the server yet (set SMTP_URL or RESEND_API_KEY).");
  }
}

const FROM = () => process.env.EMAIL_FROM || "Recap <no-reply@personalrecap.com>";

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_URL || process.env.SMTP_HOST);
}

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (transporter) return transporter;
  if (process.env.SMTP_URL) {
    transporter = nodemailer.createTransport(process.env.SMTP_URL);
  } else {
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function sendViaResend(email: OutgoingEmail) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM(), to: [email.to], subject: email.subject, html: email.html, text: email.text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email provider rejected the message (${res.status}) ${detail.slice(0, 200)}`);
  }
}

export async function sendEmail(email: OutgoingEmail) {
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();
  // Two attempts: transient SMTP/HTTP failures are common and cheap to retry
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (process.env.RESEND_API_KEY) {
        await sendViaResend(email);
      } else {
        await smtp().sendMail({ from: FROM(), to: email.to, subject: email.subject, html: email.html, text: email.text });
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
