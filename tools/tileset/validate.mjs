// Bake VALIDATOR — checks a generated tile/sprite for correct geometry using the LMStudio vision model
// (Maddy: "we need validators on tile bakes ... gemma model"). The diffusion model is unreliable for
// strict top-down on long subjects (the side-view step van) and floodfill can eat light sprites — this
// catches both so the bake can retry a different seed instead of shipping a vibe-killer.
//
//   import { isTopDown } from './validate.mjs'
import { execFileSync } from 'node:child_process';

const LM_URL = (process.env.LMSTUDIO_URL ?? 'https://lmstudio.tailea7e08.ts.net').replace(/\/$/, '');
const LM_MODEL = process.env.LM_MODEL ?? 'google/gemma-4-26b-a4b';

/** Upscale a tiny PNG (nearest) so the vision model can actually see it. */
function upscale(buf, to = 192) {
  return execFileSync('magick', ['png:-', '-filter', 'point', '-resize', `${to}x${to}`, 'png:-'], {
    input: buf,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Ask the vision model `question` about `pngBuffer`; returns the raw answer text (empty on failure). */
export async function askVision(pngBuffer, question, { timeoutMs = 90000 } = {}) {
  const b64 = upscale(pngBuffer).toString('base64');
  const body = {
    model: LM_MODEL,
    temperature: 0,
    max_tokens: 1500, // reasoning model: needs headroom for reasoning_content BEFORE the answer lands in content
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${LM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return '';
    const json = await res.json();
    const msg = json?.choices?.[0]?.message ?? {};
    // Prefer the final answer (content); fall back to the reasoning trace if the model spent all
    // tokens reasoning (content empty) — the conclusion is usually in there too.
    return (msg.content && msg.content.trim()) || msg.reasoning_content || '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Classify a YES/NO answer. The model is told to START with YES/NO, so trust that first; only fall
 *  back to keyword heuristics for a reasoning-trace (no leading verdict) — and there, take the LAST
 *  yes/no (the conclusion). (Don't naively match negated phrases — answers say "...NOT a side view".) */
export function readsYes(text) {
  const lead = text.trim().match(/^[*_\s]*(yes|no)\b/i);
  if (lead) return lead[1].toLowerCase() === 'yes';
  const t = text.toLowerCase();
  const lastYes = t.lastIndexOf('yes');
  const lastNo = t.lastIndexOf('no');
  if (lastYes !== -1 || lastNo !== -1) return lastYes > lastNo;
  return false;
}

/** Back-compat alias (top-down used the same YES/NO-first reader). */
function readsTopDown(text) {
  const lead = text.trim().match(/^[*_\s]*(yes|no)\b/i);
  if (lead) return lead[1].toLowerCase() === 'yes';
  const t = text.toLowerCase();
  const lastYes = t.lastIndexOf('yes');
  const lastNo = t.lastIndexOf('no');
  if (lastYes !== -1 || lastNo !== -1) return lastYes > lastNo;
  return /\b(top-?down|overhead|directly above|from above)\b/.test(t) && !/\b(side|profile|3\/4)\b/.test(t);
}

/**
 * Is `pngBuffer` a strict TOP-DOWN (overhead) view of `subject`, not a side / 3-4 view? Returns
 * { ok, text }. On an unreachable model `ok` is true (fail-OPEN — never block a bake on infra).
 */
export async function isTopDown(pngBuffer, subject) {
  const q =
    `This is a small pixel-art game sprite meant to depict "${subject}" as seen from DIRECTLY ABOVE ` +
    `(a strict top-down/overhead map view). Is it actually drawn from directly overhead — NOT a side ` +
    `view, NOT a 3/4 view, and not lying on its side? Start your answer with YES or NO.`;
  const text = await askVision(pngBuffer, q);
  if (text === '') return { ok: true, text: '(validator unreachable — passed)' }; // fail-open
  return { ok: readsTopDown(text), text };
}

/**
 * Does the FRONT of the directional `subject` (a vehicle/cyclist) point toward the TOP of the image?
 * The renderer draws these sprites assuming they face NORTH (up) and rotates them to the travel
 * heading, so a sprite whose front is at the bottom/side drives BACKWARDS or sideways (Maddy: the
 * taxi/van driving backwards). Returns { ok, text }; fail-OPEN on an unreachable model.
 */
export async function facesForward(pngBuffer, subject) {
  const q =
    `This is a small top-down pixel-art game sprite of "${subject}". Treating the TOP edge of the ` +
    `image as NORTH, is the FRONT of the vehicle (the hood/handlebars — the direction it would drive ` +
    `forward) pointing UP toward the top of the image? Answer NO if the front points down, left, or ` +
    `right, or if it is a side view. Start your answer with YES or NO.`;
  const text = await askVision(pngBuffer, q);
  if (text === '') return { ok: true, text: '(validator unreachable — passed)' }; // fail-open
  return { ok: readsYes(text), text };
}

/** Mean alpha of the CENTRAL region of a PNG (0..1). The white→alpha floodfill that ate light
 *  buildings (the white clinic roof, white cars) leaves the building BODY transparent — so a
 *  CENTER-position building tile reads near-empty in the middle. Checking the centre (not the whole
 *  tile) avoids false positives from the legitimately-transparent OUTER edges every building sprite
 *  has (it sits on transparency so the ground shows). No vision model — a fast, deterministic pixel
 *  check, so it can scan the whole baked set cheaply. */
export function centerOpacity(pngBuffer) {
  const out = execFileSync(
    'magick',
    ['png:-', '-gravity', 'center', '-crop', '50%x50%+0+0', '+repage', '-format', '%[fx:mean.a]', 'info:'],
    { input: pngBuffer, maxBuffer: 32 * 1024 * 1024 },
  );
  return Number(out.toString().trim()) || 0;
}

/** Mean alpha over the WHOLE sprite (0..1). A keyed sprite (object on transparency) has lots of
 *  removed background → a modest mean; a SOLID BOX where the floodfill removed nothing (a framed
 *  block, not a subject — e.g. the white-box pedestrian) reads near 1. Used to reject solid boxes. */
export function overallOpacity(pngBuffer) {
  const out = execFileSync('magick', ['png:-', '-format', '%[fx:mean.a]', 'info:'], {
    input: pngBuffer,
    maxBuffer: 32 * 1024 * 1024,
  });
  return Number(out.toString().trim()) || 0;
}

/** Is a CENTER-position ('c') building tile intact (its body wasn't floodfilled away)? True when the
 *  central region has at least `min` mean alpha. The default catches only EGREGIOUS floodfill (a body
 *  erased to near-empty, like the original white-roof/white-car bug ≈ 0) — a small building still has
 *  a sparse-but-present centre (~0.2), so a low bar avoids false-positiving legitimately small/light
 *  sprites. Use on full-body center cells; edge/corner cells legitimately have transparent centres.
 *  Deterministic (no vision), so it can scan the whole baked set cheaply as a flag for manual review. */
export const INTACT_MIN = 0.08;
export function isIntact(pngBuffer, min = INTACT_MIN) {
  return centerOpacity(pngBuffer) >= min;
}

// CLI: `node tools/tileset/validate.mjs <png> "<subject>" [facing|intact]` — quick manual check.
//   facing → forward-facing check; intact → center-opacity floodfill check; default → top-down.
if (process.argv[1] && process.argv[1].endsWith('validate.mjs') && process.argv[2]) {
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(process.argv[2]);
  if (process.argv[4] === 'intact') {
    const a = centerOpacity(buf);
    console.log(`ok=${a >= INTACT_MIN} centerOpacity=${a.toFixed(3)}`);
  } else {
    const check = process.argv[4] === 'facing' ? facesForward : isTopDown;
    const { ok, text } = await check(buf, process.argv[3] ?? 'object');
    console.log(`ok=${ok}\n${text}`);
  }
}
