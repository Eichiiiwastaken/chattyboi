"use server";

import { auth } from "@/app/(auth)/auth";
import { getDocumentById, getSuggestionsByDocumentId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function getSuggestions({ documentId }: { documentId: string }) {
  const session = await auth();

  if (!session?.user) {
    throw new ChatbotError("unauthorized:document");
  }

  const document = await getDocumentById({ id: documentId });

  if (!document) {
    throw new ChatbotError("not_found:document");
  }

  if (document.userId !== session.user.id) {
    throw new ChatbotError("forbidden:document");
  }

  const suggestions = await getSuggestionsByDocumentId({ documentId });
  return suggestions ?? [];
}
