import { describe, expect, it, vi } from "vitest";
import { readFormDataWithLimit } from "@/lib/http/request-form-data";
import { RequestBodyTooLargeError } from "@/lib/http/request-json";

const encoder = new TextEncoder();

function multipartBody(
  fields: {
    name: string;
    filename?: string;
    contentType?: string;
    data: string;
  }[],
  boundary: string
): Uint8Array {
  let body = "";
  for (const field of fields) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${field.name}"`;
    if (field.filename) {
      body += `; filename="${field.filename}"`;
    }
    body += "\r\n";
    if (field.contentType) {
      body += `Content-Type: ${field.contentType}\r\n`;
    }
    body += "\r\n";
    body += field.data;
    body += "\r\n";
  }
  body += `--${boundary}--\r\n`;
  return encoder.encode(body);
}

function chunkedRequest(chunks: string[], headers?: HeadersInit) {
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
    request: new Request("https://chattyboi.test/api/upload", {
      body,
      duplex: "half",
      headers,
      method: "POST",
    } as RequestInit),
  };
}

describe("readFormDataWithLimit", () => {
  it("rejects a declared oversized body before reading the stream", async () => {
    const { request } = chunkedRequest(["x"], {
      "content-length": "1025",
    });
    const getReader = vi.spyOn(request.body as ReadableStream, "getReader");

    await expect(
      readFormDataWithLimit({ maxBytes: 1024, request })
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(getReader).not.toHaveBeenCalled();
  });

  it("rejects and cancels a chunked body as soon as it crosses the limit", async () => {
    const { cancel, request } = chunkedRequest(["1234", "5678"]);

    await expect(
      readFormDataWithLimit({ maxBytes: 7, request })
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("parses a valid multipart body within the limit", async () => {
    const boundary = "----TestBoundaryForChattyboi";
    const body = multipartBody(
      [
        {
          name: "file",
          filename: "test.txt",
          contentType: "text/plain",
          data: "hello world",
        },
        {
          name: "description",
          data: "a file upload",
        },
      ],
      boundary
    );

    const request = new Request("https://chattyboi.test/api/upload", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const formData = await readFormDataWithLimit({
      maxBytes: 1024 * 1024,
      request,
    });

    expect(formData).toBeInstanceOf(FormData);
    const file = formData.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("test.txt");
    expect(await file.text()).toBe("hello world");
    expect(formData.get("description")).toBe("a file upload");
  });

  it("rejects invalid limits", async () => {
    const request = new Request("https://chattyboi.test/api/upload");

    await expect(
      readFormDataWithLimit({ maxBytes: 0, request })
    ).rejects.toBeInstanceOf(TypeError);
  });
});
