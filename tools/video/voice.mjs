// Generates the narration with ElevenLabs: one MP3 per part in out/voice/, plus durations.json.
//   npm run voice                 (picks a warm American female voice from your account)
//   VOICE_ID=... npm run voice    (use a specific voice)
// Needs ELEVENLABS_API_KEY in tools/video/.env (git-ignored).
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parts } from "./script.mjs";

const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) {
  console.error("Put your key in tools/video/.env: ELEVENLABS_API_KEY=...");
  process.exit(1);
}
const api = (p, init = {}) => fetch(`https://api.elevenlabs.io${p}`, { ...init, headers: { "xi-api-key": key, ...(init.headers ?? {}) } });
const out = path.resolve(import.meta.dirname, "out/voice");
await mkdir(out, { recursive: true });

let voiceId = process.env.VOICE_ID?.trim();
if (!voiceId) {
  const res = await api("/v1/voices");
  if (!res.ok) throw new Error(`Listing voices failed: ${res.status} ${await res.text()}`);
  const { voices } = await res.json();
  const score = (v) => {
    const l = Object.fromEntries(Object.entries(v.labels ?? {}).map(([k, x]) => [k, String(x).toLowerCase()]));
    const d = `${l.description ?? ""} ${l.descriptive ?? ""} ${l.use_case ?? ""} ${v.description ?? ""}`.toLowerCase();
    return (l.gender === "female" ? 4 : 0) + (/americ/.test(l.accent ?? "") ? 3 : 0) + (/warm|friendly|calm|soft|pleasant|reassuring/.test(d) ? 2 : 0) + (/narrat|conversational|informative|educat/.test(d) ? 1 : 0);
  };
  const ranked = voices.map((v) => ({ v, s: score(v) })).sort((a, b) => b.s - a.s);
  console.log("Top voices:");
  for (const { v, s } of ranked.slice(0, 5)) console.log(`  ${s}  ${v.name}  ${v.voice_id}  ${JSON.stringify(v.labels ?? {})}`);
  voiceId = ranked[0].v.voice_id;
  console.log(`Using ${ranked[0].v.name} (${voiceId})`);
}

const durations = {};
for (const p of parts) {
  const res = await api(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: p.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`Voice for ${p.id} failed: ${res.status} ${await res.text()}`);
  const file = path.join(out, `${p.id}.mp3`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  durations[p.id] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
  console.log(`${p.id}  ${durations[p.id].toFixed(1)}s`);
}
await writeFile(path.join(out, "durations.json"), JSON.stringify({ voiceId, durations }, null, 2));
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`Total narration: ${total.toFixed(1)}s`);
