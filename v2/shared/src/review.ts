// How many cards a session serves before it stops.
export const REVIEW_BATCH = 15;
export const FACETS: Facet[] = ["meaning", "reading", "writing"];

export type Grade =
  | "reviewed_forgot"
  | "reviewed_hard"
  | "reviewed_okay"
  | "reviewed_easy"
  | "conversation_used"
  | "conversation_missed";

// How hard the question picker leans on the weakest facet. Higher = a weak
// facet is asked more times before a stronger one gets a turn.
const FACET_TUNING = {
  facetBias: 2,
  strengthCap: 8, // ceiling on a facet's mastery level
};

import type { Facet, FacetState, Word } from "./word";

// :::::::::  :::::::::: :::     ::: ::::::::::: :::::::::: :::       :::
// :+:    :+: :+:        :+:     :+:     :+:     :+:        :+:       :+:
// +:+    +:+ +:+        +:+     +:+     +:+     +:+        +:+       +:+
// +#++:++#:  +#++:++#   +#+     +:+     +#+     +#++:++#   +#+  +:+  +#+
// +#+    +#+ +#+         +#+   +#+      +#+     +#+        +#+ +#+#+ +#+
// #+#    #+# #+#          #+#+#+#       #+#     #+#         #+#+# #+#+#
// ###    ### ##########     ###     ########### ##########   ###   ###

export interface ReviewItem {
  word: Word;
  facet: Facet;
}

// A fresh card knows none of its three facets.
export function newFacets(): Record<Facet, FacetState> {
  return {
    meaning: { strength: 0, asked: 0 },
    reading: { strength: 0, asked: 0 },
    writing: { strength: 0, asked: 0 },
  };
}

export function bumpStrength(strength: number, grade: Grade): number {
  const delta =
    grade === "reviewed_forgot" || grade === "conversation_missed"
      ? -1
      : grade === "reviewed_hard"
        ? 0
        : grade === "reviewed_easy"
          ? 2
          : 1; // reviewed_okay
  return Math.max(0, Math.min(FACET_TUNING.strengthCap, strength + delta));
}

// Deterministic weighted picker: score = asked + facetBias·strength, lowest wins
// (ties resolve in FACETS order). neglected stronger facets still resurface.
// `allowed` restricts the pick — to only the facets enabled in Settings and non-empty.
export function pickFacet(
  facets: Record<Facet, FacetState>,
  allowed: readonly Facet[] = FACETS,
): Facet {
  const score = (f: FacetState) => f.asked + FACET_TUNING.facetBias * f.strength;
  return allowed.reduce(
    (best, d) => (score(facets[d]) < score(facets[best]) ? d : best),
    allowed[0],
  );
}

// Apply a review answer to the asked facet: its mastery moves via bumpStrength,
// its rotation counter bumps, and all counters are re-based to keep them small
// (subtracting a constant from every `asked` preserves the order the picker uses).
export function recordFacetAnswer(
  facets: Record<Facet, FacetState>,
  asked: Facet,
  grade: Grade,
): Record<Facet, FacetState> {
  const bumped = {
    ...facets,
    [asked]: {
      strength: bumpStrength(facets[asked].strength, grade),
      asked: facets[asked].asked + 1,
    },
  };
  const minAsked = Math.min(...FACETS.map((d) => bumped[d].asked));
  const rebased = {} as Record<Facet, FacetState>;
  for (const d of FACETS) rebased[d] = { ...bumped[d], asked: bumped[d].asked - minAsked };
  return rebased;
}
