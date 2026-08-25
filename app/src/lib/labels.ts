import { type Facet } from "../../../shared/src";

// One source for how a question type is named in the UI. Settings lists them as
// titles ("🧠 Meaning"); the review screen's badge and its milestone line want
// the same words lowercase ("🧠 meaning"), so they share the map rather than
// keeping two copies that drift apart. `toLowerCase()` leaves the emoji alone.
export const FACET_LABEL: Record<Facet, string> = {
  meaning: "🧠 Meaning",
  reading: "🗣️ Reading",
  writing: "✍️ Writing",
};

export function facetBadge(d: Facet): string {
  return FACET_LABEL[d].toLowerCase();
}
