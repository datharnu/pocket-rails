import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isHex, type Hex } from "viem";
import { memoHash } from "@pocket-rails/sdk";
import { clientIp, limited } from "@/lib/relayer";

/**
 * Off-chain text for on-chain memo hashes.
 *
 * PocketRails stores only keccak256(note). A school (or anyone) can publish the note text here so the
 * parent's screen and the guardian agent can read it. A note is accepted only if its hash equals the memo
 * hash, so nobody can attach different text to a charge. Notes live on this server (web/.cache/notes.json),
 * never on-chain. Children's notes are not sent here: they stay on the child's device.
 *
 *   POST /api/rails/notes  { "text": "Lunch 2026-11-26" }        → { memoHash }
 *   GET  /api/rails/notes?hashes=0xabc…,0xdef…                    → { notes: { "0xabc…": "Lunch …" } }
 */
export const runtime = "nodejs";

const FILE = path.join(process.cwd(), ".cache", "notes.json");
const MAX_LEN = 160;
const MAX_NOTES = 50_000;
let notes: Record<string, string> | null = null;

async function load(): Promise<Record<string, string>> {
  if (notes) return notes;
  try {
    notes = JSON.parse(await readFile(FILE, "utf8")) as Record<string, string>;
  } catch {
    notes = {};
  }
  return notes;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("hashes") ?? "";
  const hashes = raw.split(",").map((h) => h.trim().toLowerCase()).filter((h) => isHex(h) && h.length === 66).slice(0, 200);
  const all = await load();
  return NextResponse.json({ notes: Object.fromEntries(hashes.filter((h) => all[h] !== undefined).map((h) => [h, all[h]])) });
}

export async function POST(req: Request) {
  if (limited(`notes:${clientIp(req)}`, 30)) return NextResponse.json({ error: "Too many notes. Wait a minute." }, { status: 429 });
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_LEN) return NextResponse.json({ error: `A note must be 1-${MAX_LEN} characters.` }, { status: 400 });
  const hash = memoHash(text).toLowerCase() as Hex;
  const all = await load();
  if (all[hash] === undefined) {
    if (Object.keys(all).length >= MAX_NOTES) return NextResponse.json({ error: "Note storage is full." }, { status: 507 });
    all[hash] = text;
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(all));
  }
  return NextResponse.json({ memoHash: hash });
}
