import { NextResponse } from "next/server";
import { isHex } from "viem";
import { getNotes, putNote } from "@/lib/notes";
import { clientIp, limited } from "@/lib/relayer";

/**
 * Off-chain text for on-chain memo hashes (see lib/notes.ts). A note is accepted only under its own hash.
 * Children's notes are never sent here: they stay on the child's device.
 *
 *   POST /api/rails/notes  { "text": "Lunch 2026-11-26" }        → { memoHash }
 *   GET  /api/rails/notes?hashes=0xabc…,0xdef…                    → { notes: { "0xabc…": "Lunch …" } }
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("hashes") ?? "";
  const hashes = raw.split(",").map((h) => h.trim().toLowerCase()).filter((h) => isHex(h) && h.length === 66).slice(0, 200);
  return NextResponse.json({ notes: await getNotes(hashes) });
}

export async function POST(req: Request) {
  if (limited(`notes:${clientIp(req)}`, 30)) return NextResponse.json({ error: "Too many notes. Wait a minute." }, { status: 429 });
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json({ memoHash: await putNote(typeof body.text === "string" ? body.text : "") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't store the note." }, { status: 400 });
  }
}
