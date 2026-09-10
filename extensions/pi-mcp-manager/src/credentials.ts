import { spawn } from "node:child_process";
import type { CredentialProfile, HeaderValue, SecretSource } from "./model.js";

const MAX_OUTPUT = 64 * 1024;

export function redact(message: string, secrets: readonly string[]): string {
  return secrets.filter(Boolean).sort((a, b) => b.length - a.length).reduce((text, secret) => text.split(secret).join("[REDACTED]"), message);
}

export async function resolveSecret(source: SecretSource, signal?: AbortSignal): Promise<string> {
  if ("env" in source) {
    const value = process.env[source.env];
    if (!value) throw new Error(`Environment variable ${source.env} is not set`);
    return value;
  }
  if (!source.command.length || !source.command[0]) throw new Error("Credential command is empty");
  return new Promise((resolve, reject) => {
    const child = spawn(source.command[0]!, source.command.slice(1), { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => child.kill(), source.timeoutMs ?? 10_000);
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill(); else chunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("Credential resolution cancelled"));
      if (size > MAX_OUTPUT) return reject(new Error("Credential command output exceeded 64KB"));
      if (code !== 0) return reject(new Error(`Credential command exited with code ${code}`));
      const value = Buffer.concat(chunks).toString("utf8").trim();
      if (!value || value.includes("\n")) return reject(new Error("Credential command must return one nonempty line"));
      resolve(value);
    });
  });
}

export async function resolveHeaders(
  values: Record<string, HeaderValue> | undefined,
  profiles: Record<string, CredentialProfile>,
  signal?: AbortSignal,
): Promise<{ headers: Record<string, string>; secrets: string[] }> {
  const headers: Record<string, string> = {};
  const secrets: string[] = [];
  for (const [name, setting] of Object.entries(values ?? {})) {
    if ("value" in setting) { headers[name] = setting.value; continue; }
    const source = setting.source ?? (setting.credential ? profiles[setting.credential]?.source : undefined);
    if (!source) throw new Error(`Header ${name} references an unavailable credential`);
    const secret = await resolveSecret(source, signal);
    secrets.push(secret);
    headers[name] = (setting.template ?? "{secret}").replaceAll("{secret}", secret);
  }
  return { headers, secrets };
}
