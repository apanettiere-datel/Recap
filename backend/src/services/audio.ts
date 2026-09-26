import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export const CHUNK_DURATION_SECS = 600; // 10-minute chunks keep each Whisper upload small

let ffmpegAvailable: Promise<boolean> | null = null;

/** Whether ffmpeg/ffprobe are installed (cached after the first check). */
export function hasFfmpeg(): Promise<boolean> {
  if (!ffmpegAvailable) {
    ffmpegAvailable = execFileAsync("ffmpeg", ["-version"])
      .then(() => true)
      .catch(() => {
        console.warn("[audio] ffmpeg not found — falling back to raw uploads (no repair or chunking)");
        return false;
      });
  }
  return ffmpegAvailable;
}

/** Detect the container format of an audio file from its first bytes. */
export function sniffAudioFormat(header: Uint8Array): { ext: string; mime: string } {
  if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return { ext: "webm", mime: "audio/webm" };
  }
  if (header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
    return { ext: "ogg", mime: "audio/ogg" };
  }
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
    return { ext: "wav", mime: "audio/wav" };
  }
  if ((header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) {
    return { ext: "mp3", mime: "audio/mpeg" };
  }
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
    return { ext: "m4a", mime: "audio/mp4" };
  }
  return { ext: "webm", mime: "audio/webm" };
}

export interface PreparedAudio {
  chunkPaths: string[];
  durationSecs: number | null;
}

/**
 * Decode the recording (tolerating corruption from interrupted recordings — truncated
 * WebM clusters, missing duration/cues) and re-encode it as small mono MP3 segments that
 * Whisper reliably accepts.
 */
export async function normalizeAndSplit(inputPath: string, workDir: string): Promise<PreparedAudio> {
  const pattern = join(workDir, "chunk_%03d.mp3");

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
        "-err_detect", "ignore_err",
        "-fflags", "+discardcorrupt+genpts",
        "-i", inputPath,
        "-vn", "-map", "0:a:0",
        "-ac", "1", "-ar", "16000",
        "-c:a", "libmp3lame", "-b:a", "48k",
        "-f", "segment",
        "-segment_time", String(CHUNK_DURATION_SECS),
        "-reset_timestamps", "1",
        pattern,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 },
    );
  } catch (err) {
    // ffmpeg exits non-zero on a truncated file even after writing usable output, so
    // only treat this as fatal if nothing usable was produced.
    const produced = await listChunks(workDir);
    if (produced.length === 0) {
      const stderr = (err as { stderr?: string }).stderr?.trim().split("\n").slice(-3).join(" ") ?? "";
      throw new AudioDecodeError(`ffmpeg could not decode the recording${stderr ? `: ${stderr}` : ""}`);
    }
    console.warn(`[audio] ffmpeg reported errors but produced ${produced.length} chunk(s); continuing`);
  }

  const chunkPaths = await listChunks(workDir);
  if (chunkPaths.length === 0) {
    throw new AudioDecodeError("The recording contains no decodable audio");
  }

  let total = 0;
  let known = true;
  for (const chunk of chunkPaths) {
    const d = await probeDuration(chunk);
    if (d === null) known = false;
    else total += d;
  }

  return { chunkPaths, durationSecs: known ? total : null };
}

async function listChunks(dir: string): Promise<string[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const chunks: string[] = [];
  for (const f of files.filter((f) => f.startsWith("chunk_")).sort()) {
    const path = join(dir, f);
    // Drop empty trailing segments that ffmpeg can emit for a truncated input
    const s = await stat(path).catch(() => null);
    if (s && s.size > 1024) chunks.push(path);
  }
  return chunks;
}

async function probeDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d >= 0 ? d : null;
  } catch {
    return null;
  }
}

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioDecodeError";
  }
}
