import { Children, isValidElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToolApprovalButtons } from "@/components/chat/tool-approval-buttons";

type ApprovalButtonProps = {
  children: string;
  disabled: boolean;
  onClick: () => void;
};

function renderButtons({
  disabled,
  onApprove = vi.fn(),
  onDeny = vi.fn(),
}: {
  disabled: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
}) {
  const element = ToolApprovalButtons({ disabled, onApprove, onDeny });
  const buttons = Children.toArray(element.props.children);

  if (
    buttons.length !== 2 ||
    !buttons.every((button) => isValidElement<ApprovalButtonProps>(button))
  ) {
    throw new Error("Expected exactly two approval buttons");
  }

  return buttons;
}

describe("ToolApprovalButtons", () => {
  it("renders disabled native buttons while the message is loading", () => {
    const html = renderToString(
      ToolApprovalButtons({
        disabled: true,
        onApprove: vi.fn(),
        onDeny: vi.fn(),
      })
    );
    expect(html).toContain("Deny");
    expect(html).toContain("Allow");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
  });

  it("renders enabled buttons after the message finishes loading", () => {
    const html = renderToString(
      ToolApprovalButtons({
        disabled: false,
        onApprove: vi.fn(),
        onDeny: vi.fn(),
      })
    );
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-disabled="false"');
  });

  it("does not invoke either component callback while disabled", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const [denyButton, allowButton] = renderButtons({
      disabled: true,
      onApprove,
      onDeny,
    });

    denyButton.props.onClick();
    allowButton.props.onClick();

    expect(onApprove).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("invokes the component callbacks when enabled", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const [denyButton, allowButton] = renderButtons({
      disabled: false,
      onApprove,
      onDeny,
    });

    denyButton.props.onClick();
    allowButton.props.onClick();

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
