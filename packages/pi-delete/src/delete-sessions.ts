import { spawnSync } from "node:child_process";
import { existsSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { taskDir } from "./descendants.ts";

export interface DeleteFailure {
  path: string;
  error: string;
}

/** Delete one file, preferring `trash` so the removal stays recoverable.
 *  Returns an error message when the file survives both attempts. */
export function deleteSessionFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const args = path.startsWith("-") ? ["--", path] : [path];
  const trash = spawnSync("trash", args, { encoding: "utf-8" });
  if (trash.status === 0 || !existsSync(path)) return undefined;
  try {
    unlinkSync(path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Delete every path, carrying on past failures so one stuck file cannot strand
 *  the rest half-deleted. Returns the paths that survived. Synchronous so it can
 *  run from a process `exit` handler. */
export function deleteSessionFiles(paths: string[]): DeleteFailure[] {
  const failures: DeleteFailure[] = [];
  for (const path of paths) {
    const error = deleteSessionFile(path);
    if (error) failures.push({ path, error });
  }
  // Deepest first, so a parent's directory is empty by the time it is tried.
  // Non-recursive: anything else left inside keeps the directory.
  for (const path of [...paths].reverse()) {
    const tasks = taskDir(path);
    for (const dir of [tasks, dirname(tasks)]) {
      try {
        rmdirSync(dir);
      } catch {} // absent or not empty: either way it stays
    }
  }
  return failures;
}
