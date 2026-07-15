import "dotenv/config";
import { Collection, MongoClient, ObjectId } from "mongodb";
import type { ChatMode, Direction, Facet, Srs } from "../../shared/src/types";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Set MONGODB_URI in server/.env");

export const mongo = new MongoClient(uri);
const db = mongo.db(); // database name comes from the URI

export interface WordDoc {
  _id: ObjectId;
  chinese: string;
  pinyin?: string;
  def_english?: string;
  comments?: string;
  learn_writing?: boolean;
  level_id?: number; // legacy — read once by the migration, never again
  srs?: Srs; // one schedule per card; the asked question type comes from `facets`
  facets?: Record<Direction, Facet>;
  convCreditDate?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChatDoc {
  _id: ObjectId;
  mode: ChatMode;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export const words: Collection<WordDoc> = db.collection("words");
export const chats: Collection<ChatDoc> = db.collection("chats");

export function serializeWord(doc: WordDoc) {
  return {
    _id: doc._id.toHexString(),
    chinese: doc.chinese,
    pinyin: doc.pinyin ?? "",
    def_english: doc.def_english ?? "",
    comments: doc.comments ?? "",
    learn_writing: doc.learn_writing ?? false,
    srs: doc.srs!,
    facets: doc.facets!,
    convCreditDate: doc.convCreditDate,
    createdAt: doc.createdAt?.toISOString(),
  };
}
