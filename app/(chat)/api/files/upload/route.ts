import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { readFormDataWithLimit } from "@/lib/http/request-form-data";
import { RequestBodyTooLargeError } from "@/lib/http/request-json";
import { saveUpload } from "@/lib/uploads";
import { generateUUID } from "@/lib/utils";

const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES =
  MAX_UPLOAD_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= MAX_UPLOAD_FILE_BYTES, {
      message: "File size should be less than 20MB",
    })
    .refine(
      (file) =>
        ["image/jpeg", "image/png", "application/pdf"].includes(file.type),
      {
        message: "File type should be JPEG, PNG, or PDF",
      }
    ),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await readFormDataWithLimit({
      request,
      maxBytes: MAX_MULTIPART_BODY_BYTES,
    });
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = (formData.get("file") as File).name;
    const extensionMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "application/pdf": ".pdf",
    };
    const ext = path.extname(filename) || extensionMap[file.type] || "";
    const uniqueName = `${generateUUID()}${ext}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    if (file.type.startsWith("image/")) {
      try {
        await sharp(fileBuffer).toBuffer();
      } catch {
        return NextResponse.json(
          { error: "Invalid or corrupted image file" },
          { status: 400 }
        );
      }
    }

    await saveUpload({
      filename: uniqueName,
      buffer: fileBuffer,
      metadata: {
        userId: session.user.id,
        contentType: file.type,
      },
    });

    return NextResponse.json({
      url: `/uploads/${uniqueName}`,
      pathname: uniqueName,
      contentType: file.type,
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Request body is too large" },
        { status: 413 }
      );
    }
    console.error("Failed to process upload request:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
