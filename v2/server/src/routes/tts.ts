import { Hono } from "hono";

export const ttsRoute = new Hono();

// GET /api/tts?text=寂寞 — proxy Google Translate's Mandarin TTS (the old site's
// voice). Browsers block direct cross-site loads from Google's endpoint, but
// server-side requests get the audio fine.
ttsRoute.get("/", async (c) => {
  const text = c.req.query("text")?.trim();
  if (!text) return c.json({ error: "text required" }, 400);
  if (text.length > 200) return c.json({ error: "text too long for TTS (max 200 chars)" }, 400);

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${encodeURIComponent(text)}`;
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return c.json({ error: `google tts returned ${upstream.status}` }, 502);
  }
  return c.body(upstream.body, 200, {
    "content-type": "audio/mpeg",
    "cache-control": "public, max-age=86400",
  });
});
