import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { getRouter } from "./router";
import "./styles.css";

/**
 * Single-page app entry point.
 *
 * The frontend is now a pure client bundle: it renders, routes and talks to
 * the Klinzo Operations API over REST. It has no server of its own, no server
 * functions, and no database driver — everything that touches data lives in
 * `src/services`.
 */
const router = getRouter();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element in index.html");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
