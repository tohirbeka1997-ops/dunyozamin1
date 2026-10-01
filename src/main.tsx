import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./lib/i18n";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { installRemotePosApiIfConfigured } from "./lib/remotePosApi";
import { initTelegramWebApp } from "./lib/telegramWebApp";
import { installPointerEventsGuard } from "./lib/releaseStuckPointerEvents";

installRemotePosApiIfConfigured();
initTelegramWebApp();
installPointerEventsGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppWrapper>
      <App />
    </AppWrapper>
  </StrictMode>
);
