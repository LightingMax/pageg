import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { pageg } from "./lib/bridge";
import "./styles.css";

window.pageg = pageg;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
