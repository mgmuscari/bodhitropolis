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

/** Classify the answer. The model is told to START with YES/NO, so trust that first; only fall back to
 *  keyword heuristics for a reasoning-trace (no leading verdict) — and there, a CONCLUDING side-view
 *  phrase loses to the final yes/no. (Don't naively match "side view" — answers say "...NOT a side view".) */
function readsTopDown(text) {
  const lead = text.trim().match(/^[*_\s]*(yes|no)\b/i);
  if (lead) return lead[1].toLowerCase() === 'yes';
  // Reasoning trace with no leading verdict: take the LAST yes/no mentioned (the conclusion).
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

// CLI: `node tools/tileset/validate.mjs <png> "<subject>"` — quick manual check.
if (process.argv[1] && process.argv[1].endsWith('validate.mjs') && process.argv[2]) {
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(process.argv[2]);
  const { ok, text } = await isTopDown(buf, process.argv[3] ?? 'object');
  console.log(`ok=${ok}\n${text}`);
}
