import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Grouping } from "./dashboard.ts";

export interface Preferences { grouping: Grouping }

export async function loadPreferences(path: string): Promise<Preferences> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<Preferences>;
    return { grouping: value.grouping === "state" || value.grouping === "none" ? value.grouping : "root" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { grouping: "root" };
  }
}

export async function savePreferences(path: string, preferences: Preferences): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
