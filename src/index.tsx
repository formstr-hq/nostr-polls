import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./fonts/shantell.css";
import "@fontsource-variable/fredoka";
import "@fontsource-variable/comfortaa";
import "@fontsource-variable/raleway";
import App from "./App";
import { bootstrapDataLayer } from "./dataLayer/bootstrap";

// Spawn the worker relay + wire the data layer before anything renders, so the
// `dataLayer` singleton is ready for contexts that touch it during mount.
bootstrapDataLayer();

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
