// Joins the recorded take and the narration into out/pocket-rails-demo.mp4 (1920x1080, H.264 + AAC).
//   npm run assemble
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parts } from "./script.mjs";

const out = path.join(import.meta.dirname, "out");
const { marks, cuts = [] } = JSON.parse(await readFile(path.join(out, "marks.json"), "utf8"));
const start = Math.max(0, marks.start - 0.6);
const end = marks.end + 1.0;
const ids = parts.map((p) => p.id).filter((id) => marks[id] !== undefined);

// Keep everything except the waiting stretches the recorder marked (never during narration).
const keep = [];
let t = start;
for (const [a, b] of [...cuts].sort((x, y) => x[0] - y[0])) {
  if (b <= t || a >= end) continue;
  if (a > t) keep.push([t, a]);
  t = Math.max(t, b);
}
keep.push([t, end]);
const removedBefore = (x) => cuts.reduce((sum, [a, b]) => sum + (b <= x ? b - a : a < x ? x - a : 0), 0);
const at = (x) => x - start - removedBefore(x);
const length = keep.reduce((sum, [a, b]) => sum + (b - a), 0);

const args = ["-y", "-i", path.join(out, "raw/take.webm")];
for (const id of ids) args.push("-i", path.join(out, `voice/${id}.mp3`));
const vparts = keep.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
const vconcat = `${keep.map((_, i) => `[v${i}]`).join("")}concat=n=${keep.length}:v=1:a=0,fps=30[vout]`;
const delays = ids.map((id, i) => {
  const ms = Math.max(0, Math.round(at(marks[id]) * 1000));
  return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
});
const filter = [...vparts, vconcat, ...delays, `${ids.map((_, i) => `[a${i}]`).join("")}amix=inputs=${ids.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`].join(";");
args.push(
  "-filter_complex", filter,
  "-map", "[vout]", "-map", "[aout]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
  "-movflags", "+faststart",
  "-t", length.toFixed(2),
  path.join(out, "main.mp4"),
);
console.log(`cutting ${cuts.length} waits (${(end - start - length).toFixed(1)}s); final length ${length.toFixed(1)}s`);
execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });

// A 2-second title card (intro.png) that fades into the video. It's also the poster GitHub's player shows.
execFileSync("ffmpeg", [
  "-y", "-loop", "1", "-framerate", "30", "-t", "2", "-i", path.join(import.meta.dirname, "intro.png"),
  "-i", path.join(out, "main.mp4"),
  "-filter_complex", "[0:v]format=yuv420p,setsar=1,fps=30[i];[1:v]format=yuv420p,setsar=1,fps=30[m];[i][m]xfade=transition=fade:duration=0.5:offset=1.5[v];[1:a]adelay=1500|1500[a]",
  "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart",
  path.join(out, "pocket-rails-demo.mp4"),
], { stdio: ["ignore", "ignore", "inherit"] });
console.log("out/pocket-rails-demo.mp4 (with title card)");
