// The Mongo row behind a `Word`. Same fields, but `_id` and the timestamps are
// BSON and `updatedAt` is server-only. `comments` is the one field a row may
// genuinely lack; `serializeWord` defaults it and converts to the wire shape.
export type WordDoc = Omit<Word, "_id" | "comments" | "createdAt"> & {
  _id: ObjectId;
  comments?: string;
  createdAt: Date;
  updatedAt: Date;
  // The single schedule a word had before facets got their own, kept by
  // migrateFacetSchedules so the conversion can be rolled back.
  legacy?: { srs: Srs; facets?: Partial<Record<Facet, LegacyFacetState>> };
};

// 1 message in the DB
export interface ChatDoc {
  _id: ObjectId;
  role: ChatRole;
  content: string;
  createdAt: Date;
  // Flashcards this computer turn proposed. Persisted so history replayed to the
  // model carries the tool call, not just the prose
  // Not sent to the client; the /history endpoint only exposes `content`.
  cards?: FlashcardProposal[];
}

import "dotenv/config";
import { Collection, MongoClient, ObjectId } from "mongodb";
import { type ChatRole, type Facet, type FlashcardProposal, type Srs, type Word } from "../../shared/src";
import { type LegacyFacetState, migrateFacets } from "./facets";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Set MONGODB_URI in server/.env");

export const mongo = new MongoClient(uri);
const db = mongo.db(); // database name comes from the URI

export const words: Collection<WordDoc> = db.collection("words");
export const chats: Collection<ChatDoc> = db.collection("chats");

// convert wordDoc to Word
export function serializeWord(doc: WordDoc): Word {
  return {
    _id: doc._id.toHexString(),
    chinese: doc.chinese,
    pinyin: doc.pinyin,
    english: doc.english,
    comments: doc.comments ?? "",
    learn_writing: doc.learn_writing,
    facets: doc.facets,
    convCreditDate: doc.convCreditDate,
    createdAt: doc.createdAt.toISOString(),
  };
}

// One-off: words saved before facets had their own schedules carry a single
// `srs` next to strength-only facets. Convert them (see migrateFacets) and park
// the old fields under `legacy`. Safe on every start — a converted word has no
// `srs` left, so it's skipped. Returns how many words were converted.
export async function migrateFacetSchedules(now = new Date()): Promise<number> {
  type PreSplit = Omit<WordDoc, "facets"> & {
    srs: Srs;
    facets?: Partial<Record<Facet, LegacyFacetState>>;
  };
  const old = (await words.find({ srs: { $exists: true } } as object).toArray()) as unknown as PreSplit[];
  for (const { srs, facets, ...rest } of old) {
    // replaceOne, not $set + $unset: `facets` is both read from and written to.
    await words.replaceOne(
      { _id: rest._id },
      { ...rest, facets: migrateFacets(srs, facets, now), legacy: { srs, facets } },
    );
  }
  return old.length;
}
