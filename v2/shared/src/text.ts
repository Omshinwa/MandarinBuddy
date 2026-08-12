// Cards mark the part of a word worth noticing — 话<题> (the old site's syntax)
// or 话*题* — and the markers are presentation only: they're never part of the
// word itself. Everything that reads a card's text has to agree on that, which
// is why this lives in shared: the app renders the marked run bold, TTS drops
// the markers before speaking, the chat gloss matches words without them, and
// the server strips them out of the vocabulary block it sends the model.
// Answer matching gets it for free — the markers aren't letters, so NOISE_RE in
// pinyin.ts already discards them.
export const EMPHASIS_RE = /<([^<>]+)>|\*([^*]+)\*/g;

export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS_RE, (_full, angle: string, star: string) => angle ?? star);
}

// The part of a marked field that IS the word. Markers don't just decorate: they
// pick the run that matters out of the context around it — 话<题> is a card about
// 题, with 话 there only to place it — so a marked field reduces to its marked
// run(s) and an unmarked one is the word in full. Used where a word has to be
// recognised in running text (the chat gloss); the review card still shows the
// whole thing, with the marked run bold.
export function emphasizedPart(text: string): string {
  const marked = splitEmphasis(text)
    .filter((run) => run.bold)
    .map((run) => run.text)
    .join("");
  return marked || stripEmphasis(text);
}

// The text as alternating plain/emphasised runs. An unclosed marker matches
// nothing and stays in the text as the literal character the user typed.
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
