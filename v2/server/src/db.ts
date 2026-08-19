import "dotenv/config";
import { Collection, MongoClient, ObjectId } from "mongodb";
import { type ChatRole, type FlashcardProposal, type Word } from "../../shared/src";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Set MONGODB_URI in server/.env");

export const mongo = new MongoClient(uri);
const db = mongo.db(); // database name comes from the URI

// The Mongo row behind a `Word`. Same fields, but `_id` and the timestamps are
// BSON and `updatedAt` is server-only. `comments` is the one field a row may
// genuinely lack; `serializeWord` defaults it and converts to the wire shape.
export type WordDoc = Omit<Word, "_id" | "comments" | "createdAt"> & {
  _id: ObjectId;
  comments?: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface ChatDoc {
  _id: ObjectId;
  role: ChatRole;
  content: string;
  // Flashcards this computer turn proposed. Persisted so history replayed to the
  // model carries the tool call, not just the prose
  // Not sent to the client; the /history endpoint only exposes `content`.
  cards?: FlashcardProposal[];
  createdAt: Date;
}

export const words: Collection<WordDoc> = db.collection("words");
export const chats: Collection<ChatDoc> = db.collection("chats");

export function serializeWord(doc: WordDoc): Word {
  return {
    _id: doc._id.toHexString(),
    chinese: doc.chinese,
    pinyin: doc.pinyin,
    english: doc.english,
    comments: doc.comments ?? "",
    learn_writing: doc.learn_writing,
    srs: doc.srs,
    facets: doc.facets,
    convCreditDate: doc.convCreditDate,
    createdAt: doc.createdAt.toISOString(),
  };
}
