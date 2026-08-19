// :::       :::  ::::::::  :::::::::  :::::::::  
// :+:       :+: :+:    :+: :+:    :+: :+:    :+: 
// +:+       +:+ +:+    +:+ +:+    +:+ +:+    +:+ 
// +#+  +:+  +#+ +#+    +:+ +#++:++#:  +#+    +:+ 
// +#+ +#+#+ +#+ +#+    +#+ +#+    +#+ +#+    +#+ 
//  #+#+# #+#+#  #+#    #+# #+#    #+# #+#    #+# 
//   ###   ###    ########  ###    ### #########  

// The shapes that live in Mongo. Anything transient — a grade you pressed, an
// item handed to the review screen — belongs with its logic instead, in
// ./srs or ./review.

export interface WordInput {
  chinese: string;
  pinyin: string;
  english: string;
  comments: string;
  learn_writing: boolean;
}

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
