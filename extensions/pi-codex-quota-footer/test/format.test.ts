import assert from "node:assert/strict";
import test from "node:test";
import { formatStatuses } from "../format.ts";

test("formatStatuses sorts and sanitizes extension statuses", () => {
  const statuses = new Map([
    ["zeta", "  second\nstatus  "],
    ["alpha", "first\tstatus"],
  ]);

  assert.equal(formatStatuses(statuses), "first status second status");
});

test("formatStatuses omits an empty status collection", () => {
  assert.equal(formatStatuses(new Map()), undefined);
});
