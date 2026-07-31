import "@testing-library/jest-dom";
import "fake-indexeddb/auto";

import { configure } from "@testing-library/react";

// Testing Library's default budget for findBy*/waitFor is 1000ms. Several chat tests wait
// on a multi-step pipeline behind a single findBy*: buildContext, two Dexie writes through
// fake-indexeddb, the mocked fetch, then the SSE stream drained chunk by chunk — only after
// all of that does an answer's citation become clickable.
//
// On a fast workstation that chain settles in under 20ms, so the default never binds. On a
// shared 2-core CI runner it can miss 1000ms, and the failure is silent about its cause:
// the wait expires mid-turn and Testing Library reports "unable to find" the element, as
// though the component were wrong, dumping a DOM in which the composer still shows Stop and
// the assistant message is still empty. That is exactly what failed run 30632443646 was — a
// timeout, on a docs-only PR, against code that passes on main.
//
// A longer budget costs nothing when tests pass: the wait resolves as soon as the element
// appears, it does not sleep. It only changes how long a genuinely broken test takes to
// report. vitest's testTimeout has to clear it, or the test times out first and reports
// even less — see vite.config.ts.
configure({ asyncUtilTimeout: 5000 });
