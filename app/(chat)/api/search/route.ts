import { ipAddress } from "@vercel/functions";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { searchWeb } from "@/lib/ai/tools/web-search";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";

const searchSchema = z.object({
  query: z.string().trim().min(1).max(1000),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await checkIpRateLimit(ipAddress(request));

    const parsed = searchSchema.safeParse(await request.json());

    if (!parsed.success) {
      return Response.json({ error: "Invalid search query" }, { status: 400 });
    }

    const data = await searchWeb(parsed.data.query);

    if ("error" in data) {
      return Response.json({ error: data.error }, { status: data.status });
    }

    return Response.json({ results: data.results });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }
}
