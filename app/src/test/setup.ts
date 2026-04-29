// Vitest setup. We don't globally mock fetch — per-test injection
// stays explicit. The only thing we register here is React Testing
// Library's afterEach DOM cleanup, since the project runs vitest
// with `globals: false` so RTL's auto-cleanup hook isn't picked up
// automatically.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
