import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

/**
 * A synthetic long session, built through the host's own session manager — never hand-written
 * JSON. Every message carries a unique marker so a test can prove that everything above a
 * compaction's cut point was summarised and everything below it was kept.
 *
 * Each turn is a user message, an assistant message with `read`/`edit` tool calls, and one tool
 * result, sized so a session of `turns` turns holds roughly `turns * turnTokens` host-estimated
 * tokens — enough to cross a real compaction trigger.
 */
export function longSession({ cwd, sessionDir, turns = 40, turnTokens = 1_500, readFilesPerTurn = 2 }) {
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  const session = SessionManager.create(realpathSync(cwd), sessionDir);
  const usage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const markers = [];
  const files = { read: [], modified: [] };
  // Three messages per turn, each a third of the turn's tokens at four characters per token.
  const filler = (tokens, marker) => `${marker} ${'x'.repeat(Math.max(0, tokens * 4 - marker.length - 1))}`;

  for (let turn = 0; turn < turns; turn++) {
    const user = `MARK-u${turn}`;
    const assistant = `MARK-a${turn}`;
    const result = `MARK-r${turn}`;
    markers.push(user, assistant, result);
    const reads = Array.from({ length: readFilesPerTurn }, (_, index) => `/fixture/read-${turn}-${index}.ts`);
    const edited = `/fixture/edit-${turn}.ts`;
    files.read.push(...reads);
    files.modified.push(edited);

    session.appendMessage({ role: 'user', content: filler(Math.floor(turnTokens / 3), user), timestamp: Date.now() });
    session.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: filler(Math.floor(turnTokens / 6), assistant) },
        ...reads.map((path, index) => ({ type: 'toolCall', id: `read-${turn}-${index}`, name: 'read', arguments: { path } })),
        { type: 'toolCall', id: `edit-${turn}`, name: 'edit', arguments: { path: edited, oldText: 'a', newText: 'b' } },
      ],
      timestamp: Date.now(),
      provider: 'minimax-cn',
      model: 'pi-compaction-conversation',
      usage,
      stopReason: 'toolUse',
    });
    session.appendMessage({
      role: 'toolResult',
      toolCallId: `read-${turn}-0`,
      toolName: 'read',
      content: [{ type: 'text', text: filler(Math.floor(turnTokens / 2), result) }],
      isError: false,
      timestamp: Date.now(),
    });
  }
  return { file: session.getSessionFile(), markers, files, session };
}

export function sandbox(prefix) {
  const root = realpathSync(mkdtempSync(join(process.cwd(), 'work', prefix)));
  const proj = join(root, 'proj');
  const sessions = join(root, 'sessions');
  const agent = join(root, 'agent');
  for (const dir of [proj, sessions, agent]) mkdirSync(dir, { recursive: true });
  return { root, proj, sessions, agent };
}
