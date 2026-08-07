"use client";

export function ToolApprovalButtons({
  disabled,
  onApprove,
  onDeny,
}: {
  disabled: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
      <button
        aria-disabled={disabled}
        className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          onDeny();
        }}
        type="button"
      >
        Deny
      </button>
      <button
        aria-disabled={disabled}
        className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          onApprove();
        }}
        type="button"
      >
        Allow
      </button>
    </div>
  );
}
