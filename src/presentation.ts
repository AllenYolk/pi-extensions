import type { AssistantMessageComponent, ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import type { Container, Component, TuiMouseEvent } from '@earendil-works/pi-tui';
import type * as Pi from '@earendil-works/pi-coding-agent';
import type * as Tui from '@earendil-works/pi-tui';
import { stripVTControlCharacters } from 'node:util';
import { createHash } from 'node:crypto';
import type { Config } from './config.js';

// Pi 0.85.0, 0.85.1 and 0.99.1 presentation state; all private host knowledge stays in this module.
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
  '3f8010cdede34c16dfa87b5544057cce2e38fe948c62b78998fd3630e2ad3311:702b6e2da7967989f0cf08e068f1405aede2ae529f48ec45f33402f83c3213d4:fd0c8ba64d8a398fce1ff73d93e43bc70b66ba50e06491ddeb4826c37992a302:b32d71cf32320dd71d4c6edc6a606da7340b6635bf05e2368ba5ef43bbdc6e50:2a09d118eaceb306f5fee34efd7311dd2f17b89b704ee591e4872a7476b18728:0974240ccfb41624e8a5454564d8abcd2c633416d6d3576a452b243722f40418:8bb49631ed704cc47b0b29c31b5d0a0aabc1c2027db7be9fc7c95a54d11b96e1', // Pi 0.99.1 SDK
  '1bd938ca53360d12d6dcea0c955a5c4346f00eb2d6b67cec2dcf8a8911535b92:9316e9def7d88924b6e4f5c106d7dd9b54d217a4f59890b4ce3260ab3a571259:d366fcccf73b9b9532c39e9d975d9816db5cbb2397a661c8347c4f665dcfeacc:706329ba0e6e22acb726e6d444f23754f16fcce5cc021b7574a44b2480e2ec71:d85be3dbecebd5e1573f709505d2a7f1a715c86b8f4e22a1b738f9732caa2a4b:ac16eeb745321199b90bf14eb061251773db134040d88ad63dc41b44edd0ec4e:ceb99f440539e4f4c05fe57022e5541a83317a99534d07666e187e3b416f245c', // Pi 0.99.1 CLI
]);

function displayText(value: unknown): string {
  return typeof value === 'string' ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') : '';
}

export function installPresentation(config: Config, version: unknown, report: (message: string) => void, host: { pi: typeof Pi; tui: typeof Tui; ui: Pick<Pi.ExtensionContext['ui'], 'theme'>; session?: Pick<Pi.SessionManager, 'getBranch'> }): (() => void) | undefined {
  const { AssistantMessageComponent, InteractiveMode, ToolExecutionComponent, keyText } = host.pi;
  const { Container, Text, Box, Spacer, MouseRegion, truncateToWidth } = host.tui;
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
        const failed = [...new Set(members.filter(tool => stateOf(tool).result?.isError).map(tool => displayText(stateOf(tool).toolName)))];
        const pending = members.filter(tool => stateOf(tool).isPartial).length;
        const status = [failed.length ? `failed: ${failed.join(', ')}` : '', pending ? `${pending} pending` : '', !failed.length && !pending ? 'succeeded' : ''].filter(Boolean).join('; ');
        const theme = ui!.theme;
        const lines = [
          theme.fg('toolTitle', theme.bold([...counts].map(([name, count]) => `${name} ×${count}`).join(' '))),
          theme.fg('toolOutput', status) + theme.fg('muted', ` · ${keyText('app.tools.expand') || 'click'} to expand`),
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
        const background = failed.length ? 'toolErrorBg' : pending ? 'toolPendingBg' : 'toolSuccessBg';
        const card = new Box(1, 1, text => theme.bg(background, text));
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

  function handleMouse(this: Container, event: TuiMouseEvent) {
    if (!active) return originalMouse.call(this, event);
    if (this.children.some(child => child instanceof ToolExecutionComponent)) {
      const height = render.call(this, event.width).length;
      return originalMouse.call(this, { ...event, height });
    }
    return originalMouse.call(this, event);
  }

  function render(this: Container, width: number): string[] {
    if (!active || !this.children.some(child => child instanceof ToolExecutionComponent)) return originalRender.call(this, width);
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
      for (const child of source) {
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

  const dispose = () => {
    active = undefined;
    session = undefined;
    ui = undefined;
    report = () => {};
    if (proto.render === render) Object.defineProperty(proto, 'render', descriptor);
    if (proto.handleMouse === handleMouse) Object.defineProperty(proto, 'handleMouse', mouseDescriptor);
    if (assistantProto.updateContent === updateContent) Object.defineProperty(assistantProto, 'updateContent', assistantUpdateDescriptor);
    if (assistantProto.render === renderAssistant) Object.defineProperty(assistantProto, 'render', assistantRenderDescriptor);
    if (interactiveProto.setToolsExpanded === setToolsExpanded) Object.defineProperty(interactiveProto, 'setToolsExpanded', expansionDescriptor);
    if (interactiveProto.toggleThinkingBlockVisibility === toggleThinkingBlockVisibility) Object.defineProperty(interactiveProto, 'toggleThinkingBlockVisibility', thinkingDescriptor);
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
  } catch (error) {
    const notify = report;
    dispose();
    notify(`Cannot install presentation patch: ${String(error)}; using native display`);
    return;
  }
  return dispose;
}
