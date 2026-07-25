import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({
  requestUrlMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
  requestUrl: requestUrlMock,
}));

import { createObsidianFetch } from "../../src/net/obsidian-http";

describe("Obsidian HTTP adapter", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
    requestUrlMock.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      arrayBuffer: new TextEncoder().encode('{"ok":true}').buffer,
    });
  });

  it("uses requestUrl's contentType field for form-encoded OAuth requests", async () => {
    const response = await createObsidianFetch()("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "desktop-client.apps.googleusercontent.com",
        code: "authorization-code",
        code_verifier: "pkce-verifier",
        redirect_uri: "http://127.0.0.1:12345/oauth2callback",
        grant_type: "authorization_code",
      }),
    });

    expect(requestUrlMock).toHaveBeenCalledWith({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      headers: {},
      body:
        "client_id=desktop-client.apps.googleusercontent.com&code=authorization-code" +
        "&code_verifier=pkce-verifier&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345" +
        "%2Foauth2callback&grant_type=authorization_code",
      throw: false,
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("preserves non-content-type request headers", async () => {
    await createObsidianFetch()("https://www.googleapis.com/drive/v3/files", {
      headers: {
        Authorization: "Bearer example",
        Accept: "application/json",
      },
    });

    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          accept: "application/json",
          authorization: "Bearer example",
        },
      }),
    );
  });
});
