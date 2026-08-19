// Handle the < > and * * formatting

// * * is purely cosmetic, makes it bold
// < > is to isolate a word. also makes it bold
// 话<题>, the important part is 题

// uses:
// TTS drops the markers before speaking
// The chat gloss matches words without them
// The server strips them out of the vocabulary block it sends the model.


// This is the regex to catch <text> or *text*
// 话<题> — 话*题* 
export const EMPHASIS_RE = /<([^<>]+)>|\*([^*]+)\*/g;

// 我<喜欢>吃<饭> → 我喜欢吃饭
export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS_RE, (_full, angle: string, star: string) => angle ?? star);
}

// "我<喜欢>吃<饭>"  ->  "喜欢饭"
export function emphasizedPart(text: string): string {
  const marked = splitEmphasis(text)
    .filter((run) => run.bold)
    .map((run) => run.text)
    .join("");
  return marked || stripEmphasis(text);
}

// The text as alternating plain/emphasised runs. An unclosed marker matches
// nothing and stays in the text as the literal character the user typed.
//
// "话<题>"  →  [ {text:"话", bold:false}, {text:"题", bold:true} ]
//               ─────── run 1 ───────    ────── run 2 ──────
//
// "我<喜欢>吃<饭>"  →  [ 我(plain), 喜欢(bold), 吃(plain), 饭(bold) ]
//
export function splitEmphasis(text: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(EMPHASIS_RE)) {
    if (m.index > at) runs.push({ text: text.slice(at, m.index), bold: false });
    runs.push({ text: m[1] ?? m[2], bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), bold: false });
  return runs;
}
