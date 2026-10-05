import * as Pi from '@earendil-works/pi-coding-agent';
import * as Tui from '@earendil-works/pi-tui';
import { loadConfig } from './config.js';
import { installPresentation } from './presentation.js';

export default function minimalDisplay(pi: Pi.ExtensionAPI): void {
  let dispose: (() => void) | undefined;
  let status = 'Native display (no interactive session)';

  pi.on('session_start', (event, ctx) => {
    dispose?.();
    dispose = undefined;
    if (ctx.mode !== 'tui' || !ctx.hasUI) return;
    const report = (message: string) => { status = message; ctx.ui.notify(`pi-minimal-display: ${message}`, 'warning'); };
    const conflict = pi.getAllTools().find(tool => /(?:^|[/@:])(?:pi-tool-display|pi-tool-compact-display|pi-compact-display)(?:[/@]|$)/.test(tool.sourceInfo?.source ?? '') || /\/(?:pi-tool-display|pi-tool-compact-display|pi-compact-display)\//.test(tool.sourceInfo?.path ?? ''));
    if (conflict) {
      report(`Conflicting renderer owns ${conflict.name}; disable the other display extension and restart Pi`);
      return;
    }
    const { config, diagnostic } = loadConfig(Pi.getAgentDir());
    if (!config) { report(diagnostic!); return; }
    const wasExpanded = ctx.ui.getToolsExpanded();
    try {
      dispose = installPresentation(config, Pi.VERSION, report, { pi: Pi, tui: Tui, ui: ctx.ui, session: ctx.sessionManager });
      if (dispose) {
        if (event.reason !== 'reload') ctx.ui.setToolsExpanded(false);
      status = `Active on Pi ${Pi.VERSION}; grouping=${config.grouping}; thinking follows Pi`;
      }
    } catch (error) {
      dispose?.();
      dispose = undefined;
      if (ctx.ui.getToolsExpanded() !== wasExpanded) ctx.ui.setToolsExpanded(wasExpanded);
      report(`Cannot load presentation: ${String(error)}; using native display`);
    }
  });

  pi.on('session_shutdown', () => {
    dispose?.();
    dispose = undefined;
    status = 'Native display (session stopped)';
  });

  pi.registerCommand('minimal-display', {
    description: 'Show compact display status and its configuration path',
    handler: async (_args, ctx) => {
      ctx.ui.notify(`${status}\nConfig: ${Pi.getAgentDir()}/extensions/pi-minimal-display/config.json`, 'info');
    },
  });
}
