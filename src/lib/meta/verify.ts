import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the `X-Hub-Signature-256` header Meta sends on every webhook POST.
 *
 * Meta computes HMAC-SHA256 over the EXACT raw request body using your App
 * Secret. This is why the route handler must call `await request.text()` and
 * pass that string here — re-serialising a parsed JSON object changes the bytes
 * and the signature will never match.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
export function verifyMetaSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): boolean {
  const { rawBody, signatureHeader, appSecret } = params;

  if (!signatureHeader) return false;

  // Header format: "sha256=<hex digest>"
  const [algorithm, receivedHex] = signatureHeader.split('=');
  if (algorithm !== 'sha256' || !receivedHex) return false;

  const expectedBuffer = createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest();

  // Buffer.from() silently truncates malformed hex, so the length check below
  // is what rejects garbage (timingSafeEqual throws on mismatched lengths).
  const receivedBuffer = Buffer.from(receivedHex, 'hex');
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
