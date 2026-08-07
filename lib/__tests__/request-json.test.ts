import { describe, expect, it, vi } from "vitest";
import {
  RequestBodyTooLargeError,
  readJsonWithLimit,
} from "@/lib/http/request-json";

const encoder = new TextEncoder();

function requestWithChunks(chunks: string[], headers?: HeadersInit) {
  let index = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    cancel,
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });

  return {
    cancel,
    request: new Request("https://chattyboi.test/api/chat", {
      body,
      duplex: "half",
      headers,
      method: "POST",
    } as RequestInit),
  };
}

describe("readJsonWithLimit", () => {
  it("parses a chunked JSON body within the byte limit", async () => {
    const { request } = requestWithChunks(['{"message":', '"hello"}']);

    await expect(readJsonWithLimit({ maxBytes: 64, request })).resolves.toEqual(
      {
        message: "hello",
      }
    );
  });

  it("accepts a body exactly at the byte limit", async () => {
    const { request } = requestWithChunks(["{}"]);

    await expect(readJsonWithLimit({ maxBytes: 2, request })).resolves.toEqual(
      {}
    );
  });

  it("rejects a declared oversized body before reading the stream", async () => {
    const { request } = requestWithChunks(["{}"], {
      "content-length": "1025",
    });
    const getReader = vi.spyOn(request.body as ReadableStream, "getReader");

    await expect(
      readJsonWithLimit({ maxBytes: 1024, request })
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(getReader).not.toHaveBeenCalled();
  });

  it("rejects and cancels a chunked body as soon as it crosses the limit", async () => {
    const { cancel, request } = requestWithChunks(["1234", "5678"]);

    await expect(
      readJsonWithLimit({ maxBytes: 7, request })
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("still reports malformed JSON within the limit", async () => {
    const { request } = requestWithChunks(["not json"]);

    await expect(
      readJsonWithLimit({ maxBytes: 64, request })
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects invalid limits", async () => {
    const request = new Request("https://chattyboi.test/api/chat");

    await expect(
      readJsonWithLimit({ maxBytes: 0, request })
    ).rejects.toBeInstanceOf(TypeError);
  });
});
