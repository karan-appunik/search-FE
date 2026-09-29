// =========================================================
// BACKEND CLIENT (server-side only)
// =========================================================
//
// Every BFF/resource route that needs to call the Express
// backend's authenticated /api/internal/* endpoints goes
// through this one helper, so the shared-secret header logic
// lives in exactly one place.
//
// This file is imported only by loaders/actions, which run on
// the server. INTERNAL_API_SECRET is read from process.env
// here and is never sent to, or readable by, the browser.
// =========================================================

function getBackendUrl(): string {
  if (!process.env.BACKEND_URL) {
    throw new Error("BACKEND_URL is missing in ai-product-search/.env");
  }

  return process.env.BACKEND_URL;
}

function getInternalSecret(): string {
  if (!process.env.INTERNAL_API_SECRET) {
    throw new Error("INTERNAL_API_SECRET is missing in ai-product-search/.env");
  }

  return process.env.INTERNAL_API_SECRET;
}

export interface BackendFetchOptions {
  method?: string;
  searchParams?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface BackendFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/*
 * Calls an authenticated backend endpoint under /api/internal.
 *
 * Returns { ok, status, data } rather than throwing on a
 * non-2xx response, so callers can surface a clean error
 * message instead of a stack trace.
 */
export async function backendInternalFetch(
  path: string,
  { method = "GET", searchParams, body, signal }: BackendFetchOptions = {}
): Promise<BackendFetchResult> {
  const url = new URL(`${getBackendUrl()}${path}`);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-secret": getInternalSecret()
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: { success: false, message: "Backend is unreachable" }
    };
  }

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, message: "Invalid backend response" };
  }

  return { ok: response.ok, status: response.status, data };
}
