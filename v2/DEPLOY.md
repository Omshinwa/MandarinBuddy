# Deploying SuperAnki v2

The [`render.yaml`](../render.yaml) Blueprint deploys **both** halves as two
services from one GitHub repo:

- **`superanki-server`** — the Hono API (`v2/server`), a Node web service.
- **`superanki-web`** — the Expo **web** build (`v2/app`), served as a static
  site. Its API URL is wired to the server automatically.

The Expo **phone** app (Expo Go / native build) isn't hosted anywhere — it's a
client you build separately and point at the same server (see the end).

You **can** just connect a GitHub repo to Render; no manual upload needed.

---

## 1. Push, then create the Blueprint

You need a MongoDB (the server doesn't ship one). Render's free tier has no
Mongo, so use a free **MongoDB Atlas** cluster and copy its connection string.
Under Atlas → Network Access, allow `0.0.0.0/0` so Render can reach it.

With this repo on GitHub:

1. Render → **New → Blueprint**, pick the repo. Render reads `render.yaml` and
   creates both services.
2. When prompted, fill in the server's two secrets:
   - `MONGODB_URI` — your Atlas connection string.
   - `DEEPSEEK_API_KEY` — from https://platform.deepseek.com
3. Deploy. You get two URLs, e.g.
   `https://superanki-server.onrender.com` (API) and
   `https://superanki-web.onrender.com` (the app).

Check `https://<server-url>/health` returns `{"ok":true}`, then open the web
URL. No build step is needed for the server — it runs TypeScript via `tsx`. The
web service runs `expo export` and publishes `dist/`.

> **Free-tier note:** free services sleep after ~15 min idle, so the first
> request after a nap takes a few seconds to wake. Upgrade if that matters.

## 2. How the web app finds the API

The Blueprint sets `superanki-web`'s `EXPO_PUBLIC_API_URL` to the server's full
public URL (`https://superanki-server.onrender.com`). It's baked into the bundle
at **build** time, so if that URL ever changes, edit the value in `render.yaml`
(or the web service's env vars) and redeploy the web service.

> Don't wire this with `fromService`/`property: host` — for a web service that
> resolves to the internal name (`superanki-server`), which the browser can't
> reach. Use the explicit https URL.

## 3. The phone app (optional)

For Expo Go or a native build, point it at the deployed server via
[`app/.env.example`](app/.env.example):

```
EXPO_PUBLIC_API_URL=https://superanki-server.onrender.com
```

Put that in `v2/app/.env` and restart the bundler. Leaving it unset keeps the
local-dev behavior (talk to a server on the same host, port 6767).

## Config recap

| Where | Var | Purpose |
|-------|-----|---------|
| server (Render) | `MONGODB_URI` | Mongo/Atlas connection string |
| server (Render) | `DEEPSEEK_API_KEY` | chat/tutor LLM |
| server (Render) | `PORT` | injected by Render; don't set it |
| web (Render) | `EXPO_PUBLIC_API_URL` | server's public https URL (in render.yaml) |
| phone build | `EXPO_PUBLIC_API_URL` | set by hand to the server URL |

CORS is already open (`app.use("*", cors())`), so the browser app can call the
API from any origin.
