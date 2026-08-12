import type { Direction } from "../../../shared/src/types";

// One source for how a question type is named in the UI. Settings lists them as
// titles ("🧠 Meaning"); the review screen's badge and its milestone line want
// the same words lowercase ("🧠 meaning"), so they share the map rather than
// keeping two copies that drift apart. `toLowerCase()` leaves the emoji alone.
export const DIRECTION_LABEL: Record<Direction, string> = {
  meaning: "🧠 Meaning",
  reading: "🗣️ Reading",
  writing: "✍️ Writing",
};

export function directionBadge(d: Direction): string {
  return DIRECTION_LABEL[d].toLowerCase();
}
