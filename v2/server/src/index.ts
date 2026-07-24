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

// Password gate for anything that changes data. The web app sends whatever
// password the user typed as the `x-app-password` header; here we compare it to
// the APP_PASSWORD env var and reject non-matching writes with 401. Reads (GET)
// and /health stay open — word lists and TTS are loaded as bare URLs that can't
// carry a header, and reading isn't what we're protecting. If APP_PASSWORD is
// unset (e.g. local dev) the gate is disabled so nothing breaks. CORS is
// registered first, so it answers the browser's OPTIONS preflight before this
// middleware ever runs.
app.use("/api/*", async (c, next) => {
  const required = process.env.APP_PASSWORD;
  if (required && c.req.method !== "GET" && c.req.header("x-app-password") !== required) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));
// The login screen posts here to check a password before storing it — reaching
// this handler at all means the gate above accepted the header.
app.post("/api/auth/check", (c) => c.json({ ok: true }));
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
