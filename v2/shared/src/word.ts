// :::       :::  ::::::::  :::::::::  :::::::::
// :+:       :+: :+:    :+: :+:    :+: :+:    :+:
// +:+       +:+ +:+    +:+ +:+    +:+ +:+    +:+
// +#+  +:+  +#+ +#+    +:+ +#++:++#:  +#+    +:+
// +#+ +#+#+ +#+ +#+    +#+ +#+    +#+ +#+    +#+
//  #+#+# #+#+#  #+#    #+# #+#    #+# #+#    #+#
//   ###   ###    ########  ###    ### #########

// The shapes that live in Mongo
export interface WordInput {
  chinese: string;
  pinyin: string;
  english: string;
  comments: string;
  learn_writing: boolean;
}

// plus the review-session state built on top.
// Scheduling logic lives in ./srs
export interface Word extends WordInput {
  _id: string;
  srs: Srs;
  facets: Record<Facet, FacetState>;
  convCreditDate?: string; // once-per-day guard on conversation credit
  createdAt?: string;
}

export type Facet = "meaning" | "reading" | "writing";

// One schedule per card. The card comes up when `due` passes
export interface Srs {
  due: string; // ISO timestamp — when this card is next reviewed
  intervalDays: number; // current gap between reviews
  ease: number; // growth multiplier applied to the interval
  lapses: number; // times forgotten
  suspended?: boolean; // Anki "leech": too many lapses → pulled from reviews until reactivated
}

// One per question aspect (meaning, reading, writing)
// Used to choose which question type to ask. `strength` rises with correct answers (max 8)
// will pick the lowest `asked + 2·strength`
export interface FacetState {
  strength: number;
  asked: number;
}

// ---------------------------------------------------------------------------
// Review session shapes and tuning.

// How many cards a session serves before it stops.
export const REVIEW_BATCH = 15;
export const FACETS: Facet[] = ["writing", "reading", "meaning"];

export const GRADES = [
  "reviewed_forgot",
  "reviewed_hard",
  "reviewed_okay",
  "reviewed_easy",
  "conversation_used",
  "conversation_missed",
] as const;

export type Grade = (typeof GRADES)[number];

export interface ReviewItem {
  word: Word;
  facet: Facet;
}

// How hard the question picker leans on the weakest facet. Higher = a weak
// facet is asked more times before a stronger one gets a turn.
export const FACET_TUNING = {
  facetBias: 2,
  strengthCap: 8, // ceiling on a facet's mastery level
};
