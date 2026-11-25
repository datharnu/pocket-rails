import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Hex } from "viem";
import { memoHash } from "@pocket-rails/sdk";

/**
 * Off-chain text for on-chain memo hashes, stored on this server (web/.cache/notes.json).
 * A note is only ever stored under its own keccak256 hash, so nobody can attach different text to a charge.
 */

const FILE = path.join(process.cwd(), ".cache", "notes.json");
export const MAX_NOTE_LEN = 160;
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

export async function getNotes(hashes: string[]): Promise<Record<string, string>> {
  const all = await load();
  return Object.fromEntries(hashes.filter((h) => all[h] !== undefined).map((h) => [h, all[h]!]));
}

/** Stores a note and returns its memo hash. Throws if the text is empty, too long, or storage is full. */
export async function putNote(text: string): Promise<Hex> {
  const t = text.trim();
  if (!t || t.length > MAX_NOTE_LEN) throw new Error(`A note must be 1-${MAX_NOTE_LEN} characters.`);
  const hash = memoHash(t).toLowerCase() as Hex;
  const all = await load();
  if (all[hash] === undefined) {
    if (Object.keys(all).length >= MAX_NOTES) throw new Error("Note storage is full.");
    all[hash] = t;
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(all));
  }
  return hash;
}
