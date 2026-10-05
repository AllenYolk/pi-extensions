// Build an isolated sandbox with a session tree, for manually testing /delete.
// Nothing here touches your real ~/.pi profile or sessions.
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// Derived from this file, not process.cwd(), so the printed commands stay
// correct when the script is run from anywhere.
const repo = dirname(dirname(fileURLToPath(import.meta.url)));

// Standing inside the sandbox is the normal state after a test run, and the
// rebuild below deletes that directory. Step out first, or process.cwd() dies
// underneath the script the moment its own cwd is removed.
process.chdir(repo);

// realpath matters: macOS tmpdir is /var/... which resolves to /private/var/...,
// and a session whose recorded cwd differs from pi's resolved cwd triggers the
// "Fork this session into current directory?" prompt on startup.
const root = join(realpathSync(tmpdir()), "pi-delete-sandbox");
const agentDir = join(root, "agent");
const proj = join(root, "proj");
const sessions = join(root, "sessions");

rmSync(root, { recursive: true, force: true });
for (const dir of [agentDir, proj, sessions]) mkdirSync(dir, { recursive: true });

const usage = {
  input: 10, output: 5, cacheRead: 0, cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function make(parentSession, text, name) {
  const sm = SessionManager.create(proj, sessions, parentSession ? { parentSession } : undefined);
  sm.appendMessage({ role: "user", content: text, timestamp: Date.now() });
  sm.appendMessage({
    role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: Date.now(),
    provider: "anthropic", model: "claude-sonnet-4", usage, stopReason: "stop",
  });
  if (name) sm.setSessionName?.(name);
  return sm.getSessionFile();
}

// main session, two subagent-like children, one grandchild
const main = make(undefined, "main session — run /delete here");
const childA = make(main, "subagent A");
const childB = make(main, "subagent B");
const grand = make(childA, "nested subagent under A");

const id = (file) => file.match(/_([0-9a-f-]+)\.jsonl$/)[1];

// Launchers instead of a printed `(cd ... && pi ...)`: pi has no --cwd, and a
// pasted cd that loses its subshell parentheses strands the caller's shell in
// a directory the next rebuild deletes.
const launcher = (name, sessionId) => {
  const path = join(root, name);
  writeFileSync(
    path,
    `#!/bin/sh\ncd ${proj} || exit 1\nPI_CODING_AGENT_DIR=${agentDir} exec pi --session ${sessionId} --session-dir ${sessions} -e ${repo}/src/index.ts\n`,
    { mode: 0o755 },
  );
  return path;
};

console.log(`sandbox: ${root}

  main ──┬── subagent A ── nested subagent under A
         └── subagent B

Open the main session (2 children + 1 grandchild):

  sh ${launcher("open-main.sh", id(main))}

Open a leaf session (no descendants, so /delete offers no cascade):

  sh ${launcher("open-leaf.sh", id(grand))}

Count what survived:

  ls -1 ${sessions} | wc -l

Rebuild, from any directory:

  node ${repo}/test/make-sandbox.mjs
`);
