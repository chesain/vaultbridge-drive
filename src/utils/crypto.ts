import { toBase64Url, toHex, utf8 } from "./encoding";

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65_536) {
    throw new RangeError("Invalid random byte length");
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomId(bytes = 18): string {
  return toBase64Url(randomBytes(bytes));
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function sha256(input: string | BufferSource): Promise<string> {
  const bytes = typeof input === "string" ? utf8(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

export async function sha256Base64Url(input: string | BufferSource): Promise<string> {
  const bytes = typeof input === "string" ? utf8(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
}

export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}
