import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotaLines, extractAccountId } from "../quota.ts";

function token(payload: unknown): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

const theme = { fg: (_color: string, text: string) => text };

test("extractAccountId validates Codex token claims", () => {
  assert.equal(extractAccountId(token({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } })), "account");
  assert.throws(() => extractAccountId("invalid"), /token format/);
  assert.throws(() => extractAccountId(token({})), /no account ID/);
});

test("buildQuotaLines formats primary and secondary windows", () => {
  const lines = buildQuotaLines({
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 25 },
      secondary_window: { used_percent: 80 },
    },
  } as never, theme as never);
  assert.deepEqual(lines, [
    "Quota 1: 75% remaining, until unknown",
    "Quota 2: 20% remaining, until unknown",
  ]);
});

test("buildQuotaLines reports unavailable usage", () => {
  assert.deepEqual(buildQuotaLines(undefined, theme as never), ["Quota usage: unavailable"]);
});
