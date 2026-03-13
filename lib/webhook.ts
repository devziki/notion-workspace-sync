/**
 * Webhook signature verification utility.
 *
 * Notion webhooks include a `x-notion-signature` header with the value
 * `sha256=<HMAC-SHA256-hex>` computed over the raw request body using the
 * workspace-specific webhook signing secret stored in an environment variable.
 *
 * Reference: https://developers.notion.com/docs/webhooks
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Reads the raw body from a Request object for signature verification.
 * Must be called before any JSON parsing — a consumed body stream cannot
 * be re-read.
 */
export async function getRawBody(request: Request): Promise<string> {
  return request.text();
}

/**
 * Computes the expected HMAC-SHA256 signature for a given body + secret.
 * Returns the signature in the form `sha256=<hex>` to match Notion's header.
 */
function computeSignature(secret: string, rawBody: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verifies a Notion webhook signature.
 *
 * @param rawBody   The raw request body string (before JSON parsing).
 * @param header    The value of the `x-notion-signature` header.
 * @param secret    The webhook signing secret from the environment variable.
 * @returns         `true` if the signature is valid, `false` otherwise.
 */
export function verifyNotionSignature(
  rawBody: string,
  header: string | null,
  secret: string
): boolean {
  if (!header) return false;

  const expected = computeSignature(secret, rawBody);

  // Use timing-safe comparison to prevent timing attacks.
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    // Buffers of different lengths throw — treat as invalid.
    return false;
  }
}

/**
 * Validates the signature on an incoming webhook request and returns the
 * parsed body. Throws a Response with status 401 on failure.
 *
 * Usage inside a route handler:
 *   const body = await validateWebhook(request, process.env.NOTION_WEBHOOK_SECRET_MAIN!);
 */
export async function validateWebhook(
  request: Request,
  secret: string | undefined
): Promise<{ rawBody: string; body: unknown }> {
  if (!secret) {
    console.error("Webhook secret is not configured.");
    throw new Response("Server misconfiguration", { status: 500 });
  }

  const rawBody = await getRawBody(request);
  const signature = request.headers.get("x-notion-signature");

  if (!verifyNotionSignature(rawBody, signature, secret)) {
    throw new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new Response("Invalid JSON body", { status: 400 });
  }

  return { rawBody, body };
}
