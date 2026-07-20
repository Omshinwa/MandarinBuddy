import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import type {
  ChatEvent,
  ChatMessage,
  ChatMode,
  Direction,
  Grade,
  ReviewItem,
  Word,
  WordInput,
} from "../../../shared/src/types";
import { Utf8StreamDecoder } from "./utf8";

function guessBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  // Accept either a full URL or a bare host — Render's service reference injects
  // the backend host with no scheme, so default a scheme-less value to https.
  if (explicit) return /^https?:\/\//.test(explicit) ? explicit : `https://${explicit}`;
  // In Expo Go / dev builds, the API runs on the same machine as the bundler.
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return `http://${hostUri.split(":")[0]}:6767`;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:6767`;
  }
  return "http://localhost:6767";
}

export const API_BASE = guessBase();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body);
  }
  return (await res.json()) as T;
}

export const api = {
  listWords: (search?: string) =>
    request<Word[]>(`/api/words${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createWord: (input: WordInput) =>
    request<Word>("/api/words", { method: "POST", body: JSON.stringify(input) }),
  updateWord: (
    id: string,
    patch: Partial<WordInput> & { resetProgress?: boolean; unsuspend?: boolean },
  ) =>
    request<Word>(`/api/words/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteWord: (id: string) => request<{ ok: true }>(`/api/words/${id}`, { method: "DELETE" }),
  reviewQueue: (batch?: number, directions?: Direction[]) => {
    const params = new URLSearchParams();
    if (batch) params.set("batch", String(batch));
    if (directions && directions.length) params.set("directions", directions.join(","));
    const qs = params.toString();
    return request<ReviewItem[]>(`/api/review/queue${qs ? `?${qs}` : ""}`);
  },
  grade: (wordId: string, direction: Direction, grade: Grade) =>
    request<Word>("/api/review/grade", {
      method: "POST",
      body: JSON.stringify({ wordId, direction, grade }),
    }),
  chatHistory: (mode: ChatMode) => request<ChatMessage[]>(`/api/chat/history?mode=${mode}`),
  clearChat: (mode: ChatMode) =>
    request<{ ok: true }>(`/api/chat/history?mode=${mode}`, { method: "DELETE" }),
};

// POST /api/chat and surface each SSE event as it streams in.
// opts.kickoff starts a review with no user message; opts.reviewing carries the
// current review-toggle state so the server can drill the user's due words.
export async function streamChat(
  mode: ChatMode,
  message: string,
  onEvent: (ev: ChatEvent) => void,
  opts?: { reviewing?: boolean; kickoff?: boolean; userLanguage?: string },
): Promise<void> {
  const res = await expoFetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode,
      message,
      reviewing: opts?.reviewing,
      kickoff: opts?.kickoff,
      userLanguage: opts?.userLanguage,
    }),
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // keep the HTTP status message
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new Utf8StreamDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}
