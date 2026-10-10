import type { AssistantMessageComponent, ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import type { Container, Component, TuiMouseEvent } from '@earendil-works/pi-tui';
import type * as Pi from '@earendil-works/pi-coding-agent';
import type * as Tui from '@earendil-works/pi-tui';
import { stripVTControlCharacters } from 'node:util';
import { createHash } from 'node:crypto';
import type { Config } from './config.js';

// Pi 0.85.0, 0.85.1, 0.99.1 and 1.1.0 presentation state; all private host knowledge stays in this module.
type ToolState = {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  expanded: boolean;
  isPartial: boolean;
  result?: { isError: boolean; content: Array<{ type: string; text?: string }> };
  ui: { requestRender(): void };
};
type InteractiveState = {
  showStatus(message: string): void;
  setToolsExpanded(expanded: boolean): void;
  toggleThinkingBlockVisibility(): void;
  ui: { requestRender(): void };
};
type AssistantState = {
  hideThinkingBlock: boolean;
  lastMessage?: Parameters<AssistantMessageComponent['updateContent']>[0];
};
const stateOf = (tool: ToolExecutionComponent) => tool as unknown as ToolState;
const assistantStateOf = (message: AssistantMessageComponent) => message as unknown as AssistantState;
const ownerKey = Symbol.for('@allenyolk/pi-minimal-display/owner');
// Tested SDK and bundled CLI methods: Container render/mouse, Assistant update/render, Interactive expansion/status/thinking visibility.
const compatibleMethodSignatures = new Set([
  '3f8010cdede34c16dfa87b5544057cce2e38fe948c62b78998fd3630e2ad3311:702b6e2da7967989f0cf08e068f1405aede2ae529f48ec45f33402f83c3213d4:fd0c8ba64d8a398fce1ff73d93e43bc70b66ba50e06491ddeb4826c37992a302:b32d71cf32320dd71d4c6edc6a606da7340b6635bf05e2368ba5ef43bbdc6e50:2a09d118eaceb306f5fee34efd7311dd2f17b89b704ee591e4872a7476b18728:94a9c04043b5d37a132d63bb6ef1d40e1d51f5a430799e2eefee096d3289ee99:8bb49631ed704cc47b0b29c31b5d0a0aabc1c2027db7be9fc7c95a54d11b96e1', // Pi 0.85.0/0.85.1 SDK
  '1bd938ca53360d12d6dcea0c955a5c4346f00eb2d6b67cec2dcf8a8911535b92:9316e9def7d88924b6e4f5c106d7dd9b54d217a4f59890b4ce3260ab3a571259:ac42dc0addeaf9fb23d004b1e7ea9fe41ed770a8c7077adbcb8c4af950d22a78:706329ba0e6e22acb726e6d444f23754f16fcce5cc021b7574a44b2480e2ec71:d85be3dbecebd5e1573f709505d2a7f1a715c86b8f4e22a1b738f9732caa2a4b:388a1f191e3725bf04113c7a2523af234f51730328440410a7764feaa7e45b18:ceb99f440539e4f4c05fe57022e5541a83317a99534d07666e187e3b416f245c', // Pi 0.85.0 CLI
  '1bd938ca53360d12d6dcea0c955a5c4346f00eb2d6b67cec2dcf8a8911535b92:9316e9def7d88924b6e4f5c106d7dd9b54d217a4f59890b4ce3260ab3a571259:21231e9a625e9f97c43361e980af32dce7f77573e4edef89367971a0a521e269:706329ba0e6e22acb726e6d444f23754f16fcce5cc021b7574a44b2480e2ec71:d85be3dbecebd5e1573f709505d2a7f1a715c86b8f4e22a1b738f9732caa2a4b:d145aab960ecbe1fb83c1d67d5f473c7f1c64769a500288899075d1fd12e9d14:ceb99f440539e4f4c05fe57022e5541a83317a99534d07666e187e3b416f245c', // Pi 0.85.1 CLI
  '3f8010cdede34c16dfa87b5544057cce2e38fe948c62b78998fd3630e2ad3311:702b6e2da7967989f0cf08e068f1405aede2ae529f48ec45f33402f83c3213d4:fd0c8ba64d8a398fce1ff73d93e43bc70b66ba50e06491ddeb4826c37992a302:b32d71cf32320dd71d4c6edc6a606da7340b6635bf05e2368ba5ef43bbdc6e50:2a09d118eaceb306f5fee34efd7311dd2f17b89b704ee591e4872a7476b18728:0974240ccfb41624e8a5454564d8abcd2c633416d6d3576a452b243722f40418:8bb49631ed704cc47b0b29c31b5d0a0aabc1c2027db7be9fc7c95a54d11b96e1', // Pi 0.99.1 and 1.1.0 SDK
  '1bd938ca53360d12d6dcea0c955a5c4346f00eb2d6b67cec2dcf8a8911535b92:9316e9def7d88924b6e4f5c106d7dd9b54d217a4f59890b4ce3260ab3a571259:d366fcccf73b9b9532c39e9d975d9816db5cbb2397a661c8347c4f665dcfeacc:706329ba0e6e22acb726e6d444f23754f16fcce5cc021b7574a44b2480e2ec71:d85be3dbecebd5e1573f709505d2a7f1a715c86b8f4e22a1b738f9732caa2a4b:ac16eeb745321199b90bf14eb061251773db134040d88ad63dc41b44edd0ec4e:ceb99f440539e4f4c05fe57022e5541a83317a99534d07666e187e3b416f245c', // Pi 0.99.1 and 1.1.0 CLI
]);
// Independent from the tool-card seam: an unknown retry seam keeps tool cards and leaves model errors native.
const modelEventSignatures = new Set([
  '96e7a985cb042788069a15f0a3853890bbbe57106317723aec627e7ba464b534', // Pi 0.99.1 SDK
  '4b2ab60f686ebec3c8a9fce7b878a177425fafcccb9d63feb88c565621bb2c12', // Pi 0.99.1 CLI
  '8ff4f9b1a9de54e4d3bb76f876ec1945c33d23a7b064076f6f8e392c407649c2', // Pi 1.1.0 SDK
  'baf72b4539caed03763cbcc8bb8229613e69c7e4e0247c3b570cb9269a1f2074', // Pi 1.1.0 CLI
]);
const abortRetrySignatures = new Set([
  'bb861a58e531919e5798fbfe78bb36a99f507fd47efd6991c38d209910554160', // Pi 0.99.1 and 1.1.0 SDK
  'c4d7c104d3843a382b8247153395ef9ce6c60afaec821116b11f0429d4ef2e94', // Pi 0.99.1 and 1.1.0 CLI
]);
const PALETTE = {
  dark: { mixedBg: '#483c2a', eventBg: '#362428', text: '#c8cdea', muted: '#a4a8bd', warning: '#e5c274', stop: '#ef858b' },
  light: { mixedBg: '#f1e6ce', eventBg: '#f4ecee', text: '#263044', muted: '#536178', warning: '#795715', stop: '#b52235' },
} as const;

type ErrorMessage = {
  role?: string;
  stopReason?: string;
  content?: unknown;
  errorMessage?: unknown;
  provider?: unknown;
  model?: unknown;
};
type ChainPhase = 'retrying' | 'awaiting-stop' | 'resumed' | 'stopped' | 'native';
type Chain = {
  messages: ErrorMessage[];
  phase: ChainPhase;
  expanded: boolean;
};
type HostEvent = {
  type: string;
  message?: ErrorMessage;
  success?: boolean;
  aborted?: boolean;
};

function methodHash(method: unknown): string {
  return createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex');
}

function isPureError(message: ErrorMessage | undefined): message is ErrorMessage & { errorMessage: string } {
  return !!message && message.role === 'assistant' && message.stopReason === 'error' && Array.isArray(message.content) && message.content.length === 0 && typeof message.errorMessage === 'string' && message.errorMessage.length > 0;
}

function sameTarget(left: ErrorMessage, right: ErrorMessage): boolean {
  return left.provider === right.provider && left.model === right.model;
}

function displayText(value: unknown): string {
  return typeof value === 'string' ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') : '';
}

export function installPresentation(config: Config, version: unknown, report: (message: string) => void, host: { pi: typeof Pi; tui: typeof Tui; ui: Pick<Pi.ExtensionContext['ui'], 'theme'> & { requestRender?: () => void; getToolsExpanded?: () => boolean }; session?: Pick<Pi.SessionManager, 'getBranch'> }): (() => void) | undefined {
  const { AssistantMessageComponent, InteractiveMode, ToolExecutionComponent, keyText } = host.pi;
  const { Container, Text, Box, Spacer, MouseRegion, truncateToWidth, parseColor, backgroundAnsi, foregroundAnsi } = host.tui;
  const initialTheme = host.ui?.theme;
  if ([AssistantMessageComponent, InteractiveMode, ToolExecutionComponent, Container, Text, Box, Spacer, MouseRegion, truncateToWidth, keyText, initialTheme?.fg, initialTheme?.bg, initialTheme?.bold].some(value => typeof value !== 'function')) {
    report('Pi presentation exports are incompatible; using native display');
    return;
  }
  const proto = Container.prototype as Container & { [ownerKey]?: () => void };
  if (proto[ownerKey]) {
    report('Another pi-minimal-display instance owns the presentation patch; using the existing instance');
    return;
  }
  const originalRender = proto.render;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'render');
  const originalMouse = proto.handleMouse;
  const mouseDescriptor = Object.getOwnPropertyDescriptor(proto, 'handleMouse');
  const assistantProto = AssistantMessageComponent.prototype;
  const assistantUpdateDescriptor = Object.getOwnPropertyDescriptor(assistantProto, 'updateContent');
  const originalUpdate = assistantProto.updateContent;
  const assistantRenderDescriptor = Object.getOwnPropertyDescriptor(assistantProto, 'render');
  const originalAssistantRender = assistantProto.render;
  const interactiveProto = InteractiveMode.prototype as unknown as InteractiveState;
  const expansionDescriptor = Object.getOwnPropertyDescriptor(interactiveProto, 'setToolsExpanded');
  const originalSetToolsExpanded = interactiveProto.setToolsExpanded;
  const thinkingDescriptor = Object.getOwnPropertyDescriptor(interactiveProto, 'toggleThinkingBlockVisibility');
  const originalToggleThinkingBlockVisibility = interactiveProto.toggleThinkingBlockVisibility;
  const originalShowStatus = interactiveProto.showStatus;
  if (typeof originalRender !== 'function' || !descriptor?.writable || !mouseDescriptor?.writable || typeof originalMouse !== 'function' || !Object.isExtensible(proto) || typeof originalUpdate !== 'function' || !assistantUpdateDescriptor?.writable || !assistantRenderDescriptor?.writable || typeof originalAssistantRender !== 'function' || !Object.isExtensible(assistantProto) || typeof originalSetToolsExpanded !== 'function' || !expansionDescriptor?.writable || typeof originalToggleThinkingBlockVisibility !== 'function' || !thinkingDescriptor?.writable || typeof originalShowStatus !== 'function' || !Object.isExtensible(interactiveProto)) {
    report('Pi container rendering is incompatible; using native display');
    return;
  }
  const signature = [originalRender, originalMouse, originalUpdate, originalAssistantRender, originalSetToolsExpanded, originalShowStatus, originalToggleThinkingBlockVisibility].map(method => createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex')).join(':');
  if (!compatibleMethodSignatures.has(signature)) {
    report(`Pi ${String(version)} presentation methods are incompatible; using native display`);
    return;
  }
  let active: Config | undefined = config;
  let session = host.session;
  let ui: typeof host.ui | undefined = host.ui;
  const filteredAssistantRefs = new Set<WeakRef<AssistantMessageComponent>>();
  const filteredAssistants = new WeakSet<AssistantMessageComponent>();
  const modeFor = (tool: ToolExecutionComponent, settings: Config) => {
    const name = stateOf(tool).toolName;
    return Object.hasOwn(settings.tools, name) ? settings.tools[name]! : settings.default;
  };
  const colorsReady = [parseColor, backgroundAnsi, foregroundAnsi].every(value => typeof value === 'function');
  const paletteFor = (theme: { appearance?: string }) => theme.appearance === 'light' ? PALETTE.light : PALETTE.dark;
  const paintBg = (hex: string, theme: { getColorMode(): Tui.TerminalColorMode }) => {
    const ansi = backgroundAnsi(parseColor(hex), theme.getColorMode());
    return (text: string) => `${ansi}${text}\x1b[49m`;
  };
  const paintLine = (fgHex: string, bgHex: string, theme: { getColorMode(): Tui.TerminalColorMode }) => {
    const mode = theme.getColorMode();
    const fg = foregroundAnsi(parseColor(fgHex), mode);
    const bg = backgroundAnsi(parseColor(bgHex), mode);
    return (text: string) => `${bg}${fg}${text}\x1b[39;49m`;
  };
  const paintFg = (hex: string, text: string, theme: { getColorMode(): Tui.TerminalColorMode }) => `${foregroundAnsi(parseColor(hex), theme.getColorMode())}${text}\x1b[39m`;
  let modelEvents = config.modelErrors === 'compact';
  let modelNoteSent = false;
  const chains: Chain[] = [];
  let activeChain: Chain | undefined;
  let pendingError: ErrorMessage | undefined;
  let cancelRequested = false;
  let globalExpanded = host.ui.getToolsExpanded?.() ?? false;
  const observedSessions = new Map<object, { method: (...args: unknown[]) => unknown; wrapped: (...args: unknown[]) => unknown }>();
  const disableModelEvents = (reason: string) => {
    modelEvents = false;
    if (modelNoteSent) return;
    modelNoteSent = true;
    report(`Model-request presentation is incompatible (${reason}); using native model errors`);
  };
  const interactiveClass = InteractiveMode.prototype as unknown as { handleEvent?: (event: HostEvent) => unknown };
  const originalHandleEvent = interactiveClass.handleEvent;
  const handleDescriptor = Object.getOwnPropertyDescriptor(interactiveClass, 'handleEvent');
  if (modelEvents && (typeof originalHandleEvent !== 'function' || !handleDescriptor?.writable || !modelEventSignatures.has(methodHash(originalHandleEvent)))) {
    disableModelEvents(`Pi ${String(version)} retry events`);
  }
  const invalidateChain = (chain: Chain | undefined) => {
    if (!chain || chain.phase === 'native') return;
    chain.phase = 'native';
    if (activeChain === chain) activeChain = undefined;
  };
  const observeModelEvent = (event: HostEvent) => {
    if (!modelEvents) return;
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const message = event.message;
      if (isPureError(message)) pendingError = message;
      else {
        pendingError = undefined;
        if (message.stopReason === 'error' || activeChain?.phase === 'awaiting-stop') {
          invalidateChain(activeChain);
          activeChain = undefined;
        }
      }
      return;
    }
    if (event.type === 'message_start' && event.message?.role === 'user' && activeChain?.phase === 'retrying') {
      invalidateChain(activeChain);
      pendingError = undefined;
      return;
    }
    if (event.type === 'auto_retry_start') {
      if (cancelRequested || !isPureError(pendingError)) {
        if (activeChain?.phase === 'retrying') invalidateChain(activeChain);
        pendingError = undefined;
        return;
      }
      if (activeChain?.phase === 'retrying' && !sameTarget(activeChain.messages[0]!, pendingError)) {
        invalidateChain(activeChain);
        pendingError = undefined;
        return;
      }
      if (!activeChain || activeChain.phase !== 'retrying') {
        activeChain = { messages: [], phase: 'retrying', expanded: globalExpanded };
        chains.push(activeChain);
      }
      if (!activeChain.messages.includes(pendingError)) activeChain.messages.push(pendingError);
      pendingError = undefined;
      return;
    }
    if (event.type === 'auto_retry_end') {
      if (cancelRequested) {
        invalidateChain(activeChain);
        pendingError = undefined;
        cancelRequested = false;
        return;
      }
      if (!activeChain || activeChain.phase !== 'retrying') return;
      if (event.success) {
        activeChain.phase = 'resumed';
        activeChain = undefined;
        pendingError = undefined;
        return;
      }
      if (isPureError(pendingError) && sameTarget(activeChain.messages[0]!, pendingError) && !activeChain.messages.includes(pendingError)) activeChain.messages.push(pendingError);
      pendingError = undefined;
      activeChain.phase = 'awaiting-stop';
      return;
    }
    if (event.type === 'agent_settled') {
      if (cancelRequested || event.aborted) invalidateChain(activeChain?.phase === 'resumed' || activeChain?.phase === 'stopped' ? undefined : activeChain);
      else if (activeChain?.phase === 'awaiting-stop') {
        activeChain.phase = 'stopped';
        activeChain.expanded = globalExpanded;
      } else if (activeChain?.phase === 'retrying') invalidateChain(activeChain);
      activeChain = undefined;
      cancelRequested = false;
      pendingError = undefined;
    }
  };

  function updateContent(this: AssistantMessageComponent, ...args: Parameters<AssistantMessageComponent['updateContent']>) {
    const [message, streaming] = args;
    if (!active || !assistantStateOf(this).hideThinkingBlock) return originalUpdate.apply(this, args);
    if (!filteredAssistants.has(this)) {
      filteredAssistants.add(this);
      filteredAssistantRefs.add(new WeakRef(this));
    }
    try {
      return originalUpdate.call(this, { ...message, content: message.content.filter(block => block.type !== 'thinking') }, streaming);
    } finally {
      assistantStateOf(this).lastMessage = message;
    }
  }

  function renderAssistant(this: AssistantMessageComponent, width: number) {
    if (active && assistantStateOf(this).hideThinkingBlock && !filteredAssistants.has(this) && assistantStateOf(this).lastMessage) this.invalidate();
    return originalAssistantRender.call(this, width);
  }

  function group(members: ToolExecutionComponent[]): Component {
    const nativeView = new Container();
    return {
      render(width) {
        if (!active || members.some(tool => stateOf(tool).expanded)) {
          if (active) {
            for (const tool of members) if (!stateOf(tool).expanded) tool.setExpanded(true);
          }
          nativeView.children = members;
          return originalRender.call(nativeView, width);
        }
        const counts = new Map<string, number>();
        for (const tool of members) {
          const name = displayText(stateOf(tool).toolName).replace(/\s+/g, ' ');
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const failedMembers = members.filter(tool => !stateOf(tool).isPartial && stateOf(tool).result?.isError);
        const failedNames = [...new Set(failedMembers.map(tool => displayText(stateOf(tool).toolName).replace(/\s+/g, ' ')).filter(Boolean))];
        const failedCount = failedMembers.length;
        const pending = members.filter(tool => stateOf(tool).isPartial).length;
        const theme = ui!.theme;
        const palette = paletteFor(theme);
        const failedLabel = failedCount ? `${failedCount} failed: ${failedNames.join(', ')}` : '';
        const stateLabel = pending ? `${pending} pending` : failedCount ? 'completed' : 'succeeded';
        const failedText = failedLabel ? (colorsReady ? paintFg(palette.warning, failedLabel, theme) : theme.fg('warning', failedLabel)) : '';
        const status = [theme.fg('toolOutput', stateLabel), failedText].filter(Boolean).join(theme.fg('toolOutput', ' · '));
        const lines = [
          theme.fg('toolTitle', theme.bold([...counts].map(([name, count]) => `${name} ×${count}`).join(' '))),
          status + theme.fg('muted', ` · ${keyText('app.tools.expand') || 'click'} to expand`),
        ];
        const contentWidth = Math.max(1, width - 2);
        const tool = members[0]!;
        const state = stateOf(tool);
        if (!active.grouping && modeFor(tool, active) === 'lines') {
          const value = state.toolName === 'bash' ? state.args.command : state.args.path;
          const command = Array.from(displayText(value).replace(/\s+/g, ' ').trim());
          const cap = active.bash.maxCommandChars;
          const preview = command.length > cap ? `${command.slice(0, cap - 1).join('')}…` : command.join('');
          if (preview) lines.push(truncateToWidth(`${state.toolName === 'bash' ? '$' : state.toolName} ${preview}`, contentWidth));
          if (state.toolName === 'bash' && active.bash.outputLines > 0) {
            const output = state.result?.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
            lines.push(...displayText(output).split(/\r?\n/).slice(0, active.bash.outputLines).map(line => truncateToWidth(line, contentWidth)));
          }
        }
        const completedFailure = failedCount > 0 && !pending;
        const card = new Box(1, 1, completedFailure && colorsReady ? paintBg(palette.mixedBg, theme) : text => theme.bg(pending ? 'toolPendingBg' : completedFailure ? 'toolPendingBg' : 'toolSuccessBg', text));
        card.addChild(new Text(lines.join('\n'), 0, 0));
        nativeView.children = [new Spacer(1), new MouseRegion(card, event => {
          if (!active || event.type !== 'click' || event.button !== 'left') return undefined;
          for (const tool of members) tool.setExpanded(true);
          stateOf(members[0]!).ui.requestRender();
          return { handled: true };
        })];
        return originalRender.call(nativeView, width);
      },
      invalidate() {},
      handleMouse(event: TuiMouseEvent) {
        if (!active || members.some(tool => stateOf(tool).expanded)) {
          const result = originalMouse.call(nativeView, event);
          if (active && members.some(tool => !stateOf(tool).expanded)) {
            for (const tool of members) tool.setExpanded(false);
          }
          return result;
        }
        return originalMouse.call(nativeView, event);
      },
    };
  }

  function assistantMessage(child: Component): ErrorMessage | undefined {
    return child instanceof AssistantMessageComponent ? assistantStateOf(child).lastMessage as ErrorMessage | undefined : undefined;
  }

  function chainFor(message: ErrorMessage | undefined): Chain | undefined {
    if (!modelEvents || !message) return undefined;
    return chains.find(chain => chain.messages.includes(message));
  }

  function visibleChain(message: ErrorMessage | undefined): Chain | undefined {
    const chain = chainFor(message);
    return chain?.phase !== 'native' ? chain : undefined;
  }

  function chainSpan(chain: Chain, children: readonly Component[]): { start: number; end: number } | undefined {
    const members = children.flatMap((child, index) => chain.messages.includes(assistantMessage(child)!) ? [index] : []);
    if (members.length !== chain.messages.length || members.length === 0) return undefined;
    const start = members[0]!;
    const end = members[members.length - 1]!;
    for (let i = start; i <= end; i++) {
      if (!members.includes(i) && !(children[i] instanceof Spacer)) return undefined;
    }
    return { start, end };
  }

  // Pi showError appends Spacer + this notice after auto_retry_end. It is not saved, so reload never shows it.
  function skipHostRetryNotice(source: readonly Component[], end: number): number {
    const noticeAt = (index: number) => {
      const build = (source[index] as { build?: unknown } | undefined)?.build;
      return typeof build === 'function' && /^Error: Retry failed after \d+ attempts:/.test(displayText(build()));
    };
    if (noticeAt(end + 1)) return end + 1;
    if (noticeAt(end + 2)) return end + 2;
    return end;
  }

  function ensureTranscriptChains(source: readonly Component[]): void {
    if (!modelEvents) return;
    for (let i = 0; i < source.length; i++) {
      const child = source[i]!;
      const msg = assistantMessage(child);
      if (!isPureError(msg) || chainFor(msg) || pendingError === msg) continue;

      const groupMessages: ErrorMessage[] = [msg];
      let j = i + 1;
      while (j < source.length) {
        const nextChild = source[j]!;
        if (nextChild instanceof Spacer) {
          j++;
          continue;
        }
        const nextMsg = assistantMessage(nextChild);
        if (!isPureError(nextMsg) || chainFor(nextMsg) || pendingError === nextMsg) break;
        groupMessages.push(nextMsg);
        j++;
      }

      let resumed = false;
      for (let k = j; k < source.length; k++) {
        const after = source[k]!;
        if (after instanceof Spacer) continue;
        if (after instanceof ToolExecutionComponent) {
          resumed = true;
          break;
        }
        if (after instanceof AssistantMessageComponent) {
          const afterMsg = assistantMessage(after);
          if (afterMsg && !isPureError(afterMsg)) {
            resumed = true;
            break;
          }
          continue;
        }
        break;
      }

      const phase: ChainPhase = resumed ? 'resumed' : 'stopped';
      const expanded = globalExpanded;
      chains.push({ messages: groupMessages, phase, expanded });
      i = j - 1;
    }
  }

  function modelBlock(chain: Chain): Component {
    let view = new Container();
    return {
      render(width: number) {
        const theme = ui!.theme;
        const palette = paletteFor(theme);
        const expanded = chain.expanded;
        const key = keyText('app.tools.expand') || 'click';
        const count = chain.messages.length;
        const outcome = chain.phase === 'resumed' ? ' · resumed' : chain.phase === 'stopped' ? ' · stopped' : '';
        const arrow = expanded ? '▾' : '▸';
        const titleText = `model request${outcome}`;
        const suffixText = ` · ${count} ${count === 1 ? 'error' : 'errors'} · ${key} to ${expanded ? 'collapse' : 'expand'}`;
        const titleColor = chain.phase === 'stopped' ? palette.stop : palette.text;
        const styledTitle = colorsReady
          ? `${paintFg(palette.muted, arrow, theme)} ${paintFg(titleColor, titleText, theme)}${paintFg(palette.muted, suffixText, theme)}`
          : `${arrow} ${titleText}${suffixText}`;
        const rawCause = !expanded && (chain.phase === 'stopped' || chain.phase === 'awaiting-stop')
          ? displayText(chain.messages[chain.messages.length - 1]?.errorMessage).replace(/\s+/g, ' ').trim()
          : '';
        const cause = rawCause ? truncateToWidth(`Error: ${rawCause}`, Math.max(1, width - 2)) : '';
        const styledCause = cause && colorsReady ? paintFg(palette.text, cause, theme) : cause;
        const header = new Text(styledCause ? `${styledTitle}\n${styledCause}` : styledTitle, 1, 0, colorsReady ? paintBg(palette.eventBg, theme) : undefined);
        const region = new MouseRegion(header, event => {
          if (!active || event.type !== 'click' || event.button !== 'left') return undefined;
          chain.expanded = !chain.expanded;
          ui?.requestRender?.();
          return { handled: true };
        });
        view = new Container();
        view.children = [new Spacer(1), region];
        if (expanded) {
          const lines = chain.messages.map(message => `Error: ${message.errorMessage}`);
          const bodyColor = chain.phase === 'stopped' ? palette.text : palette.muted;
          view.children.push(new Text(lines.join('\n\n'), 1, 0, colorsReady ? paintLine(bodyColor, palette.eventBg, theme) : undefined));
        }
        return originalRender.call(view, width);
      },
      invalidate() {},
      handleMouse(event: TuiMouseEvent) {
        return originalMouse.call(view, event);
      },
    };
  }

  function hasModelEvent(children: readonly Component[]): boolean {
    if (!modelEvents) return false;
    ensureTranscriptChains(children);
    return children.some(child => !!visibleChain(assistantMessage(child)));
  }

  function handleMouse(this: Container, event: TuiMouseEvent) {
    if (!active) return originalMouse.call(this, event);
    if (this.children.some(child => child instanceof ToolExecutionComponent) || hasModelEvent(this.children)) {
      const height = render.call(this, event.width).length;
      return originalMouse.call(this, { ...event, height });
    }
    return originalMouse.call(this, event);
  }

  function render(this: Container, width: number): string[] {
    if (!active) return originalRender.call(this, width);
    ensureTranscriptChains(this.children);
    if (!this.children.some(child => child instanceof ToolExecutionComponent) && !hasModelEvent(this.children)) return originalRender.call(this, width);
    const source = this.children;
    try {
      const turnIds = new Map<string, string>();
      let currentTurn = 'initial';
      for (const entry of session?.getBranch() ?? []) {
        if (entry.type !== 'message') continue;
        if (entry.message.role === 'user') currentTurn = entry.id;
        if (entry.message.role === 'assistant') {
          for (const block of entry.message.content) if (block.type === 'toolCall') turnIds.set(block.id, currentTurn);
        }
      }
      const projected: Component[] = [];
      let members: ToolExecutionComponent[] | undefined;
      let groupTurn: string | undefined;
      for (let i = 0; i < source.length; i++) {
        const child = source[i]!;
        const chain = visibleChain(assistantMessage(child));
        if (chain) {
          const span = chainSpan(chain, source);
          if (span && span.start === i) {
            members = undefined;
            projected.push(modelBlock(chain));
            i = skipHostRetryNotice(source, span.end);
            continue;
          }
        }
        if (!(child instanceof ToolExecutionComponent) || modeFor(child, active) === 'native') {
          const message = child instanceof AssistantMessageComponent
            ? (child as unknown as { lastMessage?: Parameters<AssistantMessageComponent['updateContent']>[0] }).lastMessage
            : undefined;
          const hiddenByPi = child instanceof AssistantMessageComponent && assistantStateOf(child).hideThinkingBlock;
          // Tool-only and natively hidden-thinking assistant components have no visible output.
          const emptyAssistant = child instanceof AssistantMessageComponent
            && (!message || !['length', 'error', 'aborted'].includes(message.stopReason))
            && !message?.content.some(block => (block.type === 'text' && block.text.trim()) || (!hiddenByPi && block.type === 'thinking' && block.thinking.trim()));
          if (!emptyAssistant) members = undefined;
          projected.push(child);
        } else {
          const turn = turnIds.get(stateOf(child).toolCallId) ?? currentTurn;
          if (!members || !active.grouping || turn !== groupTurn) {
            members = [];
            groupTurn = turn;
            projected.push(group(members));
          }
          members.push(child);
        }
      }
      // Original rendering records the projected mouse layout; restore transcript ownership afterwards.
      this.children = projected;
      try { return originalRender.call(this, width); }
      finally { this.children = source; }
    } catch (error) {
      const notify = report;
      dispose();
      notify(`Presentation failed: ${String(error)}; using native display`);
      return originalRender.call(this, width);
    }
  }

  function setToolsExpanded(this: InteractiveState, expanded: boolean) {
    if (!active) return originalSetToolsExpanded.call(this, expanded);
    globalExpanded = expanded;
    for (const chain of chains) if (chain.phase !== 'native') chain.expanded = expanded;
    const ownStatus = Object.getOwnPropertyDescriptor(this, 'showStatus');
    const currentShowStatus = this.showStatus;
    let filtering = true;
    let suppressed = false;
    const showStatus = function(this: InteractiveState, message: string) {
      if (filtering && message === `Tool output: ${expanded ? 'expanded' : 'collapsed'}`) suppressed = true;
      else currentShowStatus.call(this, message);
    };
    Object.defineProperty(this, 'showStatus', { value: showStatus, configurable: true, writable: true });
    try {
      return originalSetToolsExpanded.call(this, expanded);
    } finally {
      filtering = false;
      if (this.showStatus === showStatus) {
        if (ownStatus) Object.defineProperty(this, 'showStatus', ownStatus);
        else delete (this as unknown as { showStatus?: InteractiveState['showStatus'] }).showStatus;
      }
      if (suppressed) this.ui.requestRender();
    }
  }

  function toggleThinkingBlockVisibility(this: InteractiveState) {
    if (!active) return originalToggleThinkingBlockVisibility.call(this);
    const ownStatus = Object.getOwnPropertyDescriptor(this, 'showStatus');
    const currentShowStatus = this.showStatus;
    let filtering = true;
    const showStatus = function(this: InteractiveState, message: string) {
      if (filtering && /^Thinking blocks: (?:hidden|visible)$/.test(message)) return;
      currentShowStatus.call(this, message);
    };
    Object.defineProperty(this, 'showStatus', { value: showStatus, configurable: true, writable: true });
    try {
      return originalToggleThinkingBlockVisibility.call(this);
    } finally {
      filtering = false;
      if (this.showStatus === showStatus) {
        if (ownStatus) Object.defineProperty(this, 'showStatus', ownStatus);
        else delete (this as unknown as { showStatus?: InteractiveState['showStatus'] }).showStatus;
      }
    }
  }

  function sameSession(mode: { sessionManager?: unknown }): boolean {
    try { return !!session && mode.sessionManager === session; } catch { return false; }
  }

  function observeSessionCancellation(mode: { session?: { abortRetry?: unknown; sessionManager?: unknown } }): boolean {
    const agentSession = mode.session;
    if (!agentSession || observedSessions.has(agentSession)) return modelEvents;
    const method = agentSession.abortRetry;
    if (typeof method !== 'function' || !abortRetrySignatures.has(methodHash(method))) {
      disableModelEvents('retry cancellation');
      return false;
    }
    const wrapped = function(this: unknown, ...args: unknown[]) {
      if (active && agentSession.sessionManager === session) cancelRequested = true;
      return (method as (...args: unknown[]) => unknown).apply(this, args);
    };
    agentSession.abortRetry = wrapped;
    observedSessions.set(agentSession, { method: method as (...args: unknown[]) => unknown, wrapped });
    return true;
  }

  async function handleEvent(this: { sessionManager?: unknown; session?: { abortRetry?: unknown; sessionManager?: unknown } }, event: HostEvent) {
    if (!active || !modelEvents || !originalHandleEvent || !sameSession(this)) return originalHandleEvent?.call(this, event);
    if (!observeSessionCancellation(this)) return originalHandleEvent.call(this, event);
    observeModelEvent(event);
    return originalHandleEvent.call(this, event);
  }

  const dispose = () => {
    active = undefined;
    session = undefined;
    ui = undefined;
    modelEvents = false;
    activeChain = undefined;
    pendingError = undefined;
    cancelRequested = false;
    chains.length = 0;
    for (const [agentSession, watch] of observedSessions) {
      if ((agentSession as { abortRetry?: unknown }).abortRetry === watch.wrapped) (agentSession as { abortRetry: unknown }).abortRetry = watch.method;
    }
    observedSessions.clear();
    report = () => {};
    if (proto.render === render) Object.defineProperty(proto, 'render', descriptor);
    if (proto.handleMouse === handleMouse) Object.defineProperty(proto, 'handleMouse', mouseDescriptor);
    if (assistantProto.updateContent === updateContent) Object.defineProperty(assistantProto, 'updateContent', assistantUpdateDescriptor);
    if (assistantProto.render === renderAssistant) Object.defineProperty(assistantProto, 'render', assistantRenderDescriptor);
    if (interactiveProto.setToolsExpanded === setToolsExpanded) Object.defineProperty(interactiveProto, 'setToolsExpanded', expansionDescriptor);
    if (interactiveProto.toggleThinkingBlockVisibility === toggleThinkingBlockVisibility) Object.defineProperty(interactiveProto, 'toggleThinkingBlockVisibility', thinkingDescriptor);
    if (interactiveClass.handleEvent === handleEvent && handleDescriptor) Object.defineProperty(interactiveClass, 'handleEvent', handleDescriptor);
    if (proto[ownerKey] === dispose) delete proto[ownerKey];
    for (const reference of filteredAssistantRefs) reference.deref()?.invalidate();
    filteredAssistantRefs.clear();
  };
  try {
    Object.defineProperty(proto, ownerKey, { value: dispose, configurable: true });
    proto.render = render;
    proto.handleMouse = handleMouse;
    assistantProto.updateContent = updateContent;
    assistantProto.render = renderAssistant;
    interactiveProto.setToolsExpanded = setToolsExpanded;
    interactiveProto.toggleThinkingBlockVisibility = toggleThinkingBlockVisibility;
    if (modelEvents && originalHandleEvent) interactiveClass.handleEvent = handleEvent;
  } catch (error) {
    const notify = report;
    dispose();
    notify(`Cannot install presentation patch: ${String(error)}; using native display`);
    return;
  }
  return dispose;
}
