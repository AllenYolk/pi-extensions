import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

export interface DeleteFailure {
  path: string;
  error: string;
}

/** Delete one file, preferring `trash` so the removal stays recoverable.
 *  Returns an error message when the file survives both attempts. */
export async function deleteSessionFile(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  const args = path.startsWith("-") ? ["--", path] : [path];
  const trash = spawnSync("trash", args, { encoding: "utf-8" });
  if (trash.status === 0 || !existsSync(path)) return undefined;
  try {
    await unlink(path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Delete every path, carrying on past failures so one stuck file cannot strand
 *  the rest half-deleted. Returns the paths that survived. */
export async function deleteSessionFiles(paths: string[]): Promise<DeleteFailure[]> {
  const failures: DeleteFailure[] = [];
  for (const path of paths) {
    const error = await deleteSessionFile(path);
    if (error) failures.push({ path, error });
  }
  return failures;
}
