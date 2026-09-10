import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "../src/auth-store.js";
import { PersistentOAuthProvider } from "../src/oauth.js";

test("OAuth provider persists and invalidates authorization state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-mcp-auth-"));
  try {
    const path = join(directory, "auth.json");
    const store = new AuthStore(path);
    await store.load();
    const provider = new PersistentOAuthProvider("server", store, new URL("http://127.0.0.1/callback"), () => undefined);
    await provider.saveCodeVerifier("verifier");
    await provider.saveTokens({ access_token: "secret", token_type: "bearer" });
    assert.equal(provider.codeVerifier(), "verifier");
    assert.equal(provider.tokens()?.access_token, "secret");

    const loaded = new AuthStore(path);
    await loaded.load();
    assert.equal(loaded.get("server").tokens?.access_token, "secret");
    await loaded.clear("server", "tokens");
    assert.equal(loaded.get("server").tokens, undefined);
    assert.match(await readFile(path, "utf8"), /"version": 1/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
