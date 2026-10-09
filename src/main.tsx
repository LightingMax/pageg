import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { pageg } from "./lib/bridge";
import { installWebviewPolyfills } from "./lib/webview-polyfills";
import "./styles.css";

installWebviewPolyfills();
window.pageg = pageg;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
