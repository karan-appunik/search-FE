import type { Config } from "@react-router/dev/config";

// =========================================================
// REACT ROUTER CONFIG
// =========================================================
//
// allowedActionOrigins — CONFIRMED ROOT CAUSE (proven with a
// controlled A/B test against the real Shopify CLI dev
// session, using a real captured request; see below):
//
// `shopify app dev` runs a Cloudflare quick tunnel
// (cloudflared) that terminates HTTPS at Cloudflare's edge and
// forwards plain HTTP to the local Vite dev server. The
// browser's real `Origin` header correctly reports the public
// HTTPS origin (e.g. https://<random>.trycloudflare.com), but
// React Router's single-fetch CSRF check
// (throwIfPotentialCSRFAttack) compares that against
// `request.url`, whose scheme is reconstructed from the
// internal plain-HTTP connection — it does not honor
// `x-forwarded-proto`. So the same domain compares as
// `https://X` vs `http://X`, origins never match, and the
// check rejects the request as a potential CSRF attack even
// though it is entirely legitimate, same-origin traffic from
// the embedded app.
//
// Proof: captured the real PUT /api/goal.data request from
// Save Rule (Origin: https://<tunnel>.trycloudflare.com,
// Host: <tunnel>.trycloudflare.com, sec-fetch-site:
// same-origin) — replaying it with Origin using https:// gives
// 400 Bad Request; replaying the identical request with only
// the Origin scheme changed to http:// (matching the actual
// internal connection) succeeds. Confirms scheme mismatch, not
// a null/sandboxed origin.
//
// *.trycloudflare.com is allow-listed because the CLI
// generates a new random subdomain every `shopify app dev`
// session — a specific hostname would break on the next
// restart. isAllowedOrigin() compares the Origin header's HOST
// only (scheme-independent), so this does not weaken the
// scheme check for any origin outside this pattern, and it has
// no effect on authenticate.admin() or the internal-secret
// check, which still run in full inside each route.
//
// Production deployments behind their own TLS-terminating
// reverse proxy could hit the same class of mismatch; if so,
// add that deployment's own domain here rather than assuming
// this pattern covers it.
// =========================================================

export default {
  allowedActionOrigins: ["*.trycloudflare.com"]
} satisfies Config;
