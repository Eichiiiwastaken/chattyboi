export function shouldPersistChatStream({
  hasStoredRegenerationTarget,
  isOneTimeChat,
  streamFailed,
}: {
  hasStoredRegenerationTarget: boolean;
  isOneTimeChat: boolean;
  streamFailed: boolean;
}) {
  if (isOneTimeChat) {
    return false;
  }

  // A failed regeneration must leave the existing persisted suffix intact.
  // Normal failures still persist an error beside the saved user request, and
  // intentional aborts keep their useful partial response.
  return !(hasStoredRegenerationTarget && streamFailed);
}
