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
  facets: Record<Facet, Srs>; // one schedule per question type
  convCreditDate?: string; // once-per-day guard on conversation credit
  createdAt?: string;
}

export type Facet = "meaning" | "reading" | "writing";

// One schedule per facet. The facet comes up when `due` passes
export interface Srs {
  due: string; // ISO timestamp — when this facet is next reviewed
  intervalDays: number; // current gap between reviews
  ease: number; // growth multiplier applied to the interval
  lapses: number; // times forgotten
  suspended?: boolean; // Anki "leech": too many lapses → pulled from reviews until reactivated
  // ISO timestamp of the last review answer (conversation grades don't count).
  // Set once = the facet has started, so it stays unlocked for good.
  lastReviewed?: string;
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
