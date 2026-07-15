import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mongo, words } from "./db";
import { chatRoute } from "./routes/chat";
import { reviewRoute } from "./routes/review";
import { ttsRoute } from "./routes/tts";
import { wordsRoute } from "./routes/words";

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api/words", wordsRoute);
app.route("/api/review", reviewRoute);
app.route("/api/chat", chatRoute);
app.route("/api/tts", ttsRoute);

const port = Number(process.env.PORT ?? 6767);

async function main() {
  await mongo.connect();
  const total = await words.countDocuments();
  const migrated = await words.countDocuments({ srs: { $exists: true } });
  console.log(`MongoDB connected — ${total} words (${migrated} with srs)`);
  if (migrated < total) {
    console.log(`⚠ ${total - migrated} words not migrated yet — run: npm run migrate`);
  }
  // Bind all interfaces (not just localhost) so hosts like Render can reach it.
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  console.log(`API listening on port ${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
