// Interval buckets for color-coding the word list; palette carried over from the
// old site. App-only: the server never colours anything, so this stays out of
// `shared` even though it reads a card's srs interval.

export const BUCKETS = [
  { maxDays: 1, color: "#ffffff", label: "new " },
  { maxDays: 3, color: "#ddc1ff", label: "1–3d" },
  { maxDays: 7, color: "#99e9fa", label: "3–7d" },
  { maxDays: 14, color: "#91ffc0", label: "1–2w" },
  { maxDays: 30, color: "#fffaab", label: "2–4w" },
  { maxDays: 90, color: "#ffcf9d", label: "1–3mo" },
  { maxDays: Infinity, color: "#f5a3a3", label: "3mo+" },
];

export function intervalBucket(intervalDays: number): number {
  const i = BUCKETS.findIndex((b) => intervalDays < b.maxDays);
  return i === -1 ? BUCKETS.length - 1 : i;
}
