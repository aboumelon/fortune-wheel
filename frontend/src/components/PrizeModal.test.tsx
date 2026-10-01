import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { t } from "../i18n";
import { PrizeModal } from "./PrizeModal";

const prize = {
  id: 1,
  slot: 0,
  name: "Test prize",
  description: "Test description",
  icon: "★",
  color: "#7C3AED",
};

it("moves focus into the dialog, traps it, closes on Escape, and restores focus", async () => {
  const user = userEvent.setup();
  const trigger = document.createElement("button");
  const appContent = document.createElement("div");
  appContent.id = "application-content";
  document.body.appendChild(trigger);
  document.body.appendChild(appContent);
  trigger.focus();
  const onClose = vi.fn();

  const { unmount } = render(<PrizeModal prize={prize} onClose={onClose} />);

  const closeButton = screen.getByRole("button", { name: t("modal.close") });
  expect(closeButton).toHaveFocus();
  expect(document.getElementById("application-content")).toHaveAttribute("inert");
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: t("modal.confirm") })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();

  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
  appContent.remove();
});
