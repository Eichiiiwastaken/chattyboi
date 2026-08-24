"use client";

import { ClockIcon, PanelLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
  isOneTimeChat,
  isNewChat,
  hasMessages,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  isOneTimeChat: boolean;
  isNewChat: boolean;
  hasMessages: boolean;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const router = useRouter();
  const showOneTimeOption = isNewChat && !hasMessages && !isReadonly;

  if (state === "collapsed" && !isMobile && !showOneTimeOption) {
    return null;
  }

  return (
    <header className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-3 z-20 flex h-10 w-fit items-center gap-1">
      <Button
        className="rounded-full border border-border/50 bg-background/90 shadow-sm backdrop-blur-md md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      {showOneTimeOption ? (
        <div className="flex h-8 items-center gap-2 rounded-full border border-border/50 bg-background/90 px-2.5 text-muted-foreground text-xs shadow-sm backdrop-blur-md transition-colors hover:text-foreground">
          <ClockIcon className="size-3.5" />
          <span>One-time chat</span>
          <Switch
            aria-label="One-time chat"
            checked={isOneTimeChat}
            className="h-4 w-7 border p-0.5 [&>span]:size-3 [&>span[data-state=checked]]:translate-x-2.5"
            onCheckedChange={(checked) => {
              router.push(
                checked
                  ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/?temporary=true`
                  : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`
              );
            }}
          />
        </div>
      ) : isOneTimeChat ? (
        <div className="flex h-8 items-center gap-2 rounded-full border border-border/50 bg-background/90 px-2.5 text-muted-foreground text-xs shadow-sm backdrop-blur-md">
          <ClockIcon className="size-3.5" />
          One-time chat
        </div>
      ) : (
        !isReadonly && (
          <VisibilitySelector
            chatId={chatId}
            className="rounded-full border-border/50 bg-background/90 shadow-sm backdrop-blur-md hover:bg-muted/70"
            selectedVisibilityType={selectedVisibilityType}
          />
        )
      )}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.isOneTimeChat === nextProps.isOneTimeChat &&
    prevProps.isNewChat === nextProps.isNewChat &&
    prevProps.hasMessages === nextProps.hasMessages
  );
});
