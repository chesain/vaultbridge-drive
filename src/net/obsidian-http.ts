import { requestUrl } from "obsidian";

export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createObsidianFetch(): HttpFetch {
  return async (input, init = {}) => {
    assertNotAborted(init.signal);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const contentType = headers["content-type"];
    delete headers["content-type"];
    const response = await requestUrl({
      url: input,
      method: init.method,
      ...(contentType === undefined ? {} : { contentType }),
      headers,
      body: await requestBody(init.body),
      throw: false,
    });
    assertNotAborted(init.signal);
    const body = [204, 205, 304].includes(response.status) ? null : response.arrayBuffer;
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

async function requestBody(
  body: BodyInit | null | undefined,
): Promise<string | ArrayBuffer | undefined> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.arrayBuffer();
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice().buffer;
  }
  throw new TypeError("VaultBridge cannot send this request body type");
}

function assertNotAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted === true) throw new DOMException("The request was aborted", "AbortError");
}
