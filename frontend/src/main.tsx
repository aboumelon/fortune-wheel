import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/estedad";

import App from "./App";
import { t } from "./i18n";
import "./styles.css";

document.title = t("app.title");
document
  .querySelector('meta[name="description"]')
  ?.setAttribute("content", t("app.description"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
