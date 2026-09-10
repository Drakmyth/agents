import { createServer } from "node:http";

export const OAUTH_CALLBACK_PORT = 33418;
export const OAUTH_CALLBACK_URL = new URL(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`);

export async function listenForOAuthCallback(signal?: AbortSignal): Promise<{
  result: Promise<{ code: string; state: string | null }>;
  close: () => Promise<void>;
}> {
  let resolve!: (value: { code: string; state: string | null }) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<{ code: string; state: string | null }>((yes, no) => { resolve = yes; reject = no; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", OAUTH_CALLBACK_URL);
    if (url.pathname !== OAUTH_CALLBACK_URL.pathname) { response.writeHead(404).end(); return; }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error || !code) {
      response.writeHead(400, { "Content-Type": "text/plain" }).end("MCP authorization failed. You may close this window.");
      reject(new Error(error ? `OAuth authorization failed: ${error}` : "OAuth callback did not contain a code"));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" }).end("MCP authorization complete. You may close this window.");
    resolve({ code, state: url.searchParams.get("state") });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", resolveListen);
  });
  const abort = () => reject(new Error("OAuth authorization cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  return {
    result,
    close: async () => {
      signal?.removeEventListener("abort", abort);
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    },
  };
}
