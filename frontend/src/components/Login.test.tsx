import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { ApiError } from "../api";
import { t } from "../i18n";
import { Login } from "./Login";

it("localizes network failures instead of showing a browser exception", async () => {
  render(<Login onLogin={async () => { throw new ApiError("NETWORK_ERROR"); }} />);

  await userEvent.type(screen.getByLabelText(t("login.username")), "sara");
  await userEvent.type(screen.getByLabelText(t("login.password")), "secret-value");
  await userEvent.click(screen.getByRole("button", { name: t("login.submit") }));

  expect(await screen.findByText(t("error.NETWORK_ERROR"))).toBeVisible();
  expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
});
