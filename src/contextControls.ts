import { ICellModel } from '@jupyterlab/cells';
import { NotebookPanel } from '@jupyterlab/notebook';
import { aiRole, contextRevisionKey, customSeed, ContextMode, contextMode, contextModes, emptySourceForMode, modeCandidateIds, notebookCells, NotebookCellSnapshot, snapshotTransportError, toolChoiceMetadata, toolDeclarationNames } from './context';

const key = 'nbinlineai';
type AI = Record<string, unknown>;
export interface ContextPreview {
  selected_cell_ids: string[];
  included_cell_ids: string[];
  omitted_cell_ids: string[];
  partial_cell_ids: string[];
  excluded_cell_ids?: string[];
  ineligible_cells?: Array<{ id: string; reason: string }>;
  tools?: string[];
  partial_cells?: Array<{ id: string; retained: 'suffix' | 'prefix' }>;
  snapshot_generation?: number;
}
export interface PreviewRequest {
  snapshot_version: 1;
  notebook_cells: NotebookCellSnapshot[];
  context_mode: ContextMode;
  prompt_cell_id: string;
  prompt: string;
  session_id: string;
  preview_generation: number;
}
export function notebookContextMode(panel: NotebookPanel): ContextMode {
  const ai = panel.content.model?.getMetadata(key) as { defaults?: { contextMode?: unknown } } | undefined;
  return contextMode(ai?.defaults?.contextMode);
}
function aiCell(cell: ICellModel): AI { return (cell.getMetadata(key) as AI | undefined) || {}; }
function saveMode(panel: NotebookPanel, mode: ContextMode, initialized?: boolean): void {
  const model = panel.content.model;
  if (!model) return;
  const value = (model.getMetadata(key) as AI | undefined) || {};
  model.setMetadata(key, { ...value, defaults: { ...((value.defaults as AI | undefined) || {}), contextMode: mode },
    ...(initialized ? { customContextInitialized: true } : {}) });
}
function hasCustomChoices(panel: NotebookPanel): boolean {
  const raw = panel.content.model?.getMetadata(key) as AI | undefined;
  return raw?.customContextInitialized === true || !!panel.content.model?.cells && Array.from({ length: panel.content.model.cells.length }, (_, i) => panel.content.model!.cells.get(i)).some(cell => typeof aiCell(cell).contextInclude === 'boolean');
}
function seedChoices(panel: NotebookPanel, selected: Set<string>, click?: { id: string; checked: boolean }): void {
  const model = panel.content.model;
  if (!model) return;
  model.sharedModel.transact(() => {
    const cells = notebookCells(model, model.cells.get(0)?.id || '');
    const metadata = customSeed(cells, selected, click);
    for (let i = 0; i < model.cells.length; i++) {
      model.cells.get(i).setMetadata(key, metadata[i].ai);
    }
    saveMode(panel, 'custom', true);
  });
}
function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10000 && value.every(id => typeof id === 'string');
}
function parsePreview(value: unknown): ContextPreview {
  if (!value || typeof value !== 'object') throw new Error('Invalid context preview response.');
  const raw = value as Record<string, unknown>;
  for (const name of ['selected_cell_ids', 'included_cell_ids', 'omitted_cell_ids', 'partial_cell_ids']) {
    if (!validIds(raw[name])) throw new Error('Invalid context preview cell IDs.');
  }
  if (raw.tools !== undefined && (!Array.isArray(raw.tools) || !raw.tools.every(name => typeof name === 'string'))) {
    throw new Error('Invalid context preview tools.');
  }
  return raw as unknown as ContextPreview;
}

/** Presentation only: keep per-cell controls above this cell's own input area. */
export function ensureCellControls(node: HTMLElement): HTMLElement {
  let host = node.querySelector(':scope > [data-nbinlineai-cell-controls]') as HTMLElement | null;
  if (!host) {
    host = document.createElement('div');
    host.dataset.nbinlineaiCellControls = '';
    const line = document.createElement('div');
    line.dataset.nbinlineaiCellContextLine = '';
    host.append(line);
  }
  const input = node.querySelector(':scope > .jp-Cell-inputWrapper');
  const header = node.querySelector(':scope > .jp-Cell-header');
  if (input && host.nextElementSibling !== input) node.insertBefore(host, input);
  else if (!host.parentElement) node.insertBefore(host, header?.nextSibling || node.firstChild);
  const editor = input?.querySelector('.jp-InputArea-editor');
  if (editor && host.isConnected) {
    const editorRect = editor.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    if (editorRect.width > 0 && hostRect.width > 0) {
      host.style.setProperty('--nbinlineai-editor-inset', `${Math.max(0, Math.round(editorRect.left - hostRect.left))}px`);
    }
  }
  return host;
}

export class NotebookContextControls {
  private targetId: string | null = null;
  private preview: ContextPreview | null = null;
  private generation = 0;
  private previewFingerprint = '';
  private pending = false;
  private checkedAt: number | null = null;
  private lastCheckClock = 0;
  private checkFailed = false;
  private notice = '';
  private holdTarget = false;
  private holdTimer: number | null = null;
  private refreshTimer: number | null = null;
  private requestController: AbortController | null = null;
  private alive = true;
  private viewCells: NotebookCellSnapshot[] | null = null;
  private viewPreview: ContextPreview | null = null;
  private viewSelected = new Set<string>();
  private viewTargetIndex = -1;
  private viewById = new Map<string, NotebookCellSnapshot>();
  private viewPromptIds = new Set<string>();
  private viewPositions = new Map<string, number>();
  readonly modeSelect: HTMLSelectElement;
  readonly caption: HTMLElement;
  readonly refreshButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly details: HTMLDetailsElement;
  readonly report: HTMLElement;

  constructor(private panel: NotebookPanel, private previewRequest: (body: PreviewRequest, signal: AbortSignal) => Promise<unknown>, private redraw: () => void,
    private settingsKey: (targetId: string | null) => unknown = () => null) {
    this.modeSelect = document.createElement('select');
    this.modeSelect.dataset.nbinlineaiContextMode = '';
    this.modeSelect.setAttribute('aria-label', 'Notebook Context mode');
    for (const [mode, label] of contextModes) {
      const option = document.createElement('option'); option.value = mode; option.textContent = label;
      this.modeSelect.append(option);
    }
    this.modeSelect.addEventListener('change', () => this.changeMode(contextMode(this.modeSelect.value)));
    this.caption = document.createElement('span'); this.caption.dataset.nbinlineaiContextTarget = '';
    this.refreshButton = document.createElement('button'); this.refreshButton.type = 'button';
    this.refreshButton.dataset.nbinlineaiContextRefresh = ''; this.refreshButton.textContent = 'Check context';
    this.refreshButton.title = 'Update the estimate after Python values or functions change. This does not ask the AI or change the notebook; running an AI question checks context again.';
    this.refreshButton.setAttribute('aria-description', this.refreshButton.title);
    this.refreshButton.addEventListener('click', () => { void this.refresh(); });
    this.status = document.createElement('span'); this.status.dataset.nbinlineaiContextStatus = '';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('aria-atomic', 'true');
    this.details = document.createElement('details'); this.details.dataset.nbinlineaiContextDetails = '';
    const summary = document.createElement('summary');
    const summaryLabel = document.createElement('span'); summaryLabel.textContent = 'Details';
    summary.append(summaryLabel);
    this.report = document.createElement('div'); this.report.dataset.nbinlineaiContextReport = '';
    const help = document.createElement('p');
    help.textContent = 'Context is the notebook text sent with an AI question. Choose a mode or check cells to select useful text. Even Full notebook leaves out this question’s own answer, and selected text may be shortened to fit the character budget.';
    const toolsHelp = document.createElement('p');
    toolsHelp.textContent = 'The question and available tools also use space. Tools named above this question stay available even when their cell’s text is unchecked; use each Tools checkbox to change that. The estimate may change after Python values or functions change; Check context updates it without asking the AI. Running a question always checks context again.';
    this.details.append(summary, this.caption, this.status, help, toolsHelp, this.refreshButton, this.report);
    this.panel.content.node.addEventListener('pointerdown', this.onControlPointer, true);
    this.panel.content.node.addEventListener('focusin', this.onControlFocus, true);
  }
  dispose(): void {
    this.alive = false;
    this.panel.content.node.removeEventListener('pointerdown', this.onControlPointer, true);
    this.panel.content.node.removeEventListener('focusin', this.onControlFocus, true);
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.requestController?.abort();
  }
  private onControlPointer = (event: Event): void => {
    if ((event.target as Element)?.closest('[data-nbinlineai-context-control], [data-nbinlineai-tools-control]')) this.holdSelection();
  };
  private onControlFocus = (event: Event): void => {
    if ((event.target as Element)?.closest('[data-nbinlineai-context-control], [data-nbinlineai-tools-control]')) this.holdSelection();
  };
  private holdSelection(): void {
    this.holdTarget = true;
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => { this.holdTarget = false; }, 100);
  }
  onActiveCellChanged(explicitInsertion = false): void {
    if (this.holdTarget && !explicitInsertion) return;
    const cell = this.panel.content.activeCell?.model;
    if (!cell) return;
    const ai = aiCell(cell);
    const id = ai.isPromptCell === true ? cell.id : ai.isOutputCell === true && typeof ai.promptCellId === 'string' ? ai.promptCellId : null;
    if (id && id !== this.targetId) {
      this.targetId = id;
      this.invalidate();
      const questionSource = id === cell.id ? cell.sharedModel.getSource() : this.snapshot()?.find(item => item.id === id)?.source || '';
      if (questionSource.trim()) this.scheduleRefresh();
    }
  }
  onModelChanged(): void {
    this.targetId = null;
    this.invalidate();
  }
  onKernelStatus(status: string): void {
    if (['restarting', 'autorestarting', 'terminating', 'dead', 'disconnected', 'unknown'].includes(status)) this.invalidate();
  }
  private snapshot(): NotebookCellSnapshot[] | null {
    const model = this.panel.content.model;
    if (!model || !this.targetId) return null;
    try { return notebookCells(model, this.targetId); } catch { return null; }
  }
  private fingerprint(cells: NotebookCellSnapshot[]): string {
    return contextRevisionKey(cells, this.targetId, notebookContextMode(this.panel),
      this.panel.sessionContext.session?.id, this.panel.sessionContext.session?.kernel?.id, this.settingsKey(this.targetId));
  }
  invalidate(): void {
    if (this.targetId) {
      const cells = this.panel.content.model?.cells;
      let found = false;
      if (cells) for (let index = 0; index < cells.length; index++) {
        if (cells.get(index).id === this.targetId) { found = true; break; }
      }
      if (!found) this.targetId = null;
    }
    this.generation++;
    this.requestController?.abort();
    this.requestController = null;
    this.preview = null;
    this.previewFingerprint = '';
    this.pending = false;
    this.checkedAt = null;
    this.checkFailed = false;
    this.notice = this.targetId ? 'Context estimate needs updating.' : '';
    this.redraw();
  }
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = null; void this.refresh(); }, 200);
  }
  private selectionFor(mode: ContextMode, cells: NotebookCellSnapshot[]): Set<string> {
    if (!this.targetId) return new Set();
    if (mode === 'default') {
      return new Set([...(this.preview?.included_cell_ids || []), ...(this.preview?.partial_cell_ids || [])]);
    }
    return modeCandidateIds(cells, this.targetId, mode);
  }
  changeMode(mode: ContextMode): void {
    const current = notebookContextMode(this.panel);
    if (mode === 'custom' && !this.targetId) {
      saveMode(this.panel, mode);
      this.invalidate();
      return;
    }
    if (mode === 'custom' && current === 'default' && !hasCustomChoices(this.panel) && !this.currentPreview()) {
      this.notice = 'Check the Default context before creating Custom choices.';
      this.modeSelect.value = current;
      this.redraw();
      return;
    }
    if (mode === 'custom' && !hasCustomChoices(this.panel)) {
      const cells = this.snapshot();
      const selected = cells ? this.selectionFor(current, cells) : new Set<string>();
      seedChoices(this.panel, selected);
    } else saveMode(this.panel, mode);
    this.invalidate();
    this.scheduleRefresh();
  }
  changeCell(id: string, checked: boolean): void {
    const model = this.panel.content.model;
    const cells = this.snapshot();
    if (!model || !cells || !this.targetId) return;
    const current = notebookContextMode(this.panel);
    if (current === 'default' && !this.currentPreview()) return;
    if (current !== 'custom') {
      const selected = this.selectionFor(current, cells);
      seedChoices(this.panel, selected, { id, checked });
    } else if (!hasCustomChoices(this.panel)) {
      seedChoices(this.panel, modeCandidateIds(cells, this.targetId, 'custom'), { id, checked });
    } else {
      for (let i = 0; i < model.cells.length; i++) {
        const cell = model.cells.get(i);
        if (cell.id === id) { cell.setMetadata(key, { ...aiCell(cell), contextInclude: checked }); break; }
      }
    }
    this.invalidate();
    this.scheduleRefresh();
  }
  private currentPreview(): ContextPreview | null {
    const cells = this.snapshot();
    return cells && this.previewFingerprint === this.fingerprint(cells) ? this.preview : null;
  }
  /** Called once before decorating the visible widget pass. */
  prepareDecoration(): void {
    this.viewCells = this.snapshot();
    this.viewTargetIndex = this.viewCells?.findIndex(cell => cell.id === this.targetId) ?? -1;
    this.viewById = new Map(this.viewCells?.map(cell => [cell.id, cell]) || []);
    this.viewPositions = new Map(this.viewCells?.map((cell, index) => [cell.id, index]) || []);
    this.viewPromptIds = new Set(this.viewCells?.filter(cell => aiRole(cell) === 'prompt').map(cell => cell.id) || []);
    this.viewPreview = this.viewCells && this.previewFingerprint === this.fingerprint(this.viewCells) ? this.preview : null;
    this.viewSelected = this.viewCells && this.targetId ? this.selectionFor(notebookContextMode(this.panel), this.viewCells) : new Set();
  }
  async refresh(): Promise<void> {
    if (this.refreshTimer !== null) { window.clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    const cells = this.snapshot();
    const sessionId = this.panel.sessionContext.session?.id;
    if (!cells || !this.targetId || !sessionId) {
      this.checkedAt = null; this.checkFailed = !!this.targetId;
      this.notice = !this.targetId ? '' : 'Start a kernel to check context.';
      this.redraw(); return;
    }
    const transportError = snapshotTransportError(cells);
    if (transportError) { this.checkedAt = null; this.checkFailed = true; this.notice = transportError; this.redraw(); return; }
    if (this.panel.sessionContext.session?.kernel?.status !== 'idle') {
      this.checkedAt = null; this.checkFailed = true;
      this.notice = 'Kernel is busy. Check context when it is idle.';
      this.redraw(); return;
    }
    const prompt = cells.find(cell => cell.id === this.targetId)?.source.trim() || '';
    const generation = ++this.generation;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    const fingerprint = this.fingerprint(cells);
    const model = this.panel.content.model;
    this.pending = true; this.checkFailed = false; this.checkedAt = null; this.notice = 'Checking context…'; this.redraw();
    try {
      const result = parsePreview(await this.previewRequest({ snapshot_version: 1, notebook_cells: cells,
        context_mode: notebookContextMode(this.panel), prompt_cell_id: this.targetId, prompt,
        session_id: sessionId, preview_generation: generation }, controller.signal));
      if (!this.alive || generation !== this.generation) return;
      if (this.panel.content.model !== model || this.fingerprint(this.snapshot() || []) !== fingerprint ||
          result.snapshot_generation !== undefined && result.snapshot_generation !== generation) {
        this.checkFailed = true;
        this.notice = 'Notebook changed during the check. Check context again.';
        return;
      }
      this.preview = result;
      this.previewFingerprint = fingerprint;
      this.lastCheckClock = Math.max(Date.now(), this.lastCheckClock + 1);
      this.checkedAt = this.lastCheckClock;
      this.notice = `First-round estimate: ${result.selected_cell_ids.length} selected · ${result.included_cell_ids.length} included · ${result.omitted_cell_ids.length} omitted · ${result.partial_cell_ids.length} partial. Tools available: ${result.tools?.join(', ') || 'none'}.`;
    } catch (error) {
      if (this.alive && generation === this.generation) {
        this.preview = null;
        this.checkedAt = null;
        this.checkFailed = true;
        this.notice = error instanceof Error ? error.message : 'Context preview unavailable.';
      }
    } finally {
      if (this.alive && generation === this.generation) { this.pending = false; this.requestController = null; this.redraw(); }
    }
  }
  syncHeader(): void {
    const index = this.viewTargetIndex;
    this.modeSelect.value = notebookContextMode(this.panel);
    const descriptions: Record<ContextMode, string> = {
      default: 'Automatically fit nearby earlier text into the context budget.',
      'full-notebook': 'Select eligible notebook text above and below this question, within the budget.',
      'all-above': 'Select eligible text above this question, within the budget.',
      'ten-above': 'Select from the ten physical cells above this question.',
      'ten-above-below': 'Select from ten physical cells on each side of this question.',
      custom: 'Use saved per-cell Context choices.',
      'current-only': 'Use this question without optional notebook text; saved Tools choices still apply.'
    };
    this.modeSelect.title = descriptions[notebookContextMode(this.panel)];
    this.modeSelect.setAttribute('aria-description', this.modeSelect.title);
    let hasQuestion = false;
    if (index < 0) {
      const cells = this.panel.content.model?.cells;
      if (cells) for (let i = 0; i < cells.length; i++) {
        if (aiCell(cells.get(i)).isPromptCell === true) { hasQuestion = true; break; }
      }
    }
    this.caption.textContent = index < 0
      ? hasQuestion ? 'Click an AI question to check its context.' : 'Add an AI question to check its context.'
      : `Context for AI question ${index + 1}`;
    this.refreshButton.disabled = index < 0 || this.pending;
    this.refreshButton.textContent = this.pending ? 'Checking…' : 'Check context';
    if (index >= 0 && !this.pending && !this.checkFailed && this.viewPreview && this.checkedAt !== null) {
      const date = new Date(this.checkedAt);
      const timeText = `${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
      const prefix = `Context checked: ${this.viewPreview.included_cell_ids.length} ${this.viewPreview.included_cell_ids.length === 1 ? 'cell' : 'cells'}, ${this.viewPreview.tools?.length || 0} ${(this.viewPreview.tools?.length || 0) === 1 ? 'tool' : 'tools'} · Last checked `;
      if (this.status.textContent !== `${prefix}${timeText}`) {
        const time = document.createElement('time'); time.dataset.nbinlineaiContextCheckedAt = '';
        time.dateTime = date.toISOString(); time.textContent = timeText;
        this.status.replaceChildren(document.createTextNode(prefix), time);
      }
    } else {
      const status = index < 0 ? '' : this.pending ? 'Checking…' : this.checkFailed
        ? this.notice.includes('busy') ? 'Kernel busy' : 'Context check failed'
        : 'Not checked';
      if (this.status.textContent !== status) this.status.textContent = status;
    }
    this.status.title = this.notice || (index < 0 ? '' : 'First-round context estimate; open Details for explanation.');
    this.report.textContent = index < 0 ? '' : this.notice || 'Check context for a first-round estimate.';
  }
  decorateCell(cell: ICellModel, node: HTMLElement): void {
    const host = ensureCellControls(node);
    const line = host.querySelector('[data-nbinlineai-cell-context-line]') as HTMLElement;
    this.decorateTools(cell, node, line);
    let label = (line.querySelector(':scope > [data-nbinlineai-context-control]') ||
      node.querySelector(':scope > [data-nbinlineai-context-control]')) as HTMLLabelElement | null;
    if (!label) {
      label = document.createElement('label'); label.dataset.nbinlineaiContextControl = '';
      label.className = 'nbinlineai-context-control';
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.nbinlineaiContextInclude = '';
      input.setAttribute('aria-label', 'Include in AI context');
      input.addEventListener('change', () => this.changeCell(cell.id, input.checked));
      const text = document.createElement('span'); text.dataset.nbinlineaiContextText = ''; text.textContent = 'Context';
      const budget = document.createElement('span'); budget.dataset.nbinlineaiContextBudget = '';
      label.append(input, text, budget);
    }
    if (label.parentElement !== line) line.prepend(label);
    const input = label.querySelector('input')!;
    const text = (label.querySelector('[data-nbinlineai-context-text]') || label.querySelector('span')) as HTMLElement;
    text.dataset.nbinlineaiContextText = '';
    const budget = label.querySelector('[data-nbinlineai-context-budget]') as HTMLElement;
    const cells = this.viewCells;
    const targetId = this.targetId;
    const mode = notebookContextMode(this.panel);
    const ai = aiCell(cell);
    const snapshot = this.viewById.get(cell.id);
    const role = snapshot ? aiRole(snapshot) : null;
    let reason = '';
    if (!targetId || !cells) reason = 'Select an AI question';
    else if (cell.id === targetId) reason = 'Current question';
    else if (role === 'response' && (ai.promptCellId || ai.prompt_cell_id) === targetId) reason = 'Answer to this question';
    else if (cell.type === 'raw' || emptySourceForMode(cell.sharedModel.getSource(), mode)) reason = 'Empty or raw cell';
    else if (role === 'response' && ai.status !== undefined && ai.status !== 'done') reason = 'Answer is not complete';
    else if (role === 'response' && !this.viewPromptIds.has(String(ai.promptCellId || ai.prompt_cell_id))) reason = 'Orphan AI answer';
    else reason = this.viewPreview?.ineligible_cells?.find(item => item.id === cell.id)?.reason || '';
    const reasons: Record<string, string> = {
      'current-question': 'Current question', 'answer-to-current-question': 'Answer to this question',
      'raw-cell': 'Raw cell', 'empty-cell': 'Empty cell', 'answer-not-complete': 'Answer is not complete',
      'orphan-answer': 'Answer without its question',
      'default-requires-earlier-complete-pair': 'Needs earlier pair'
    };
    reason = reasons[reason] || reason;
    const isCurrentQuestion = !!targetId && cell.id === targetId;
    const previewPending = mode === 'default' && !this.viewPreview;
    input.disabled = !!reason || previewPending;
    input.hidden = isCurrentQuestion;
    label.classList.toggle('nbinlineai-current-question', isCurrentQuestion);
    if (isCurrentQuestion) label.setAttribute('aria-label', 'Current question, always included');
    else label.removeAttribute('aria-label');
    text.textContent = isCurrentQuestion ? 'Current question · always included' : 'Context';
    input.indeterminate = false;
    const reported = this.viewPreview;
    input.checked = isCurrentQuestion || (!reason && this.viewSelected.has(cell.id));
    if (mode === 'default' && reported?.partial_cell_ids.includes(cell.id) && !reason) {
      input.checked = false; input.indeterminate = true;
    }
    const omitted = reported?.omitted_cell_ids.includes(cell.id);
    const partial = reported?.partial_cell_ids.includes(cell.id);
    const retained = reported?.partial_cells?.find(item => item.id === cell.id)?.retained;
    budget.textContent = !targetId || isCurrentQuestion ? '' : reason || (partial ? 'partial' : omitted && input.checked ? 'omitted by budget' : '');
    input.title = reason === 'Needs earlier pair' ? 'Default uses completed earlier AI question/answer pairs. Choose an explicit Context mode to include this AI cell as labeled source.' : reason || (previewPending ? 'Check context to see which cells fit the Default context.' : partial
      ? retained === 'suffix' ? 'Only the ending of this cell fits the current estimate.' : retained === 'prefix' ? 'Only the beginning of this cell fits the current estimate.' : 'Only part of this cell fits the current estimate.'
      : omitted && input.checked ? 'Selected, but omitted by the current character budget.' : 'Select notebook source for AI context.');
    label.title = isCurrentQuestion ? 'This question is always sent with its own AI request.' : input.title;
  }
  private decorateTools(cell: ICellModel, node: HTMLElement, line: HTMLElement): void {
    const snapshot = this.viewById.get(cell.id) || {
      id: cell.id, cell_type: cell.type, source: cell.sharedModel.getSource(),
      metadata: cell.toJSON().metadata as Record<string, unknown>
    };
    const names = toolDeclarationNames(snapshot);
    let label = (line.querySelector(':scope > [data-nbinlineai-tools-control]') ||
      node.querySelector(':scope > [data-nbinlineai-tools-control]')) as HTMLLabelElement | null;
    if (!names.length) { label?.remove(); return; }
    if (!label) {
      label = document.createElement('label'); label.dataset.nbinlineaiToolsControl = '';
      label.className = 'nbinlineai-tools-control';
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.nbinlineaiToolsInclude = '';
      input.setAttribute('aria-label', 'Use tools from this cell');
      const description = document.createElement('span'); description.dataset.nbinlineaiToolsDescription = '';
      description.id = `nbinlineai-tools-${this.panel.id}-${cell.id}`;
      input.setAttribute('aria-describedby', description.id);
      input.addEventListener('change', () => {
        cell.setMetadata(key, toolChoiceMetadata(aiCell(cell), input.checked));
        this.invalidate(); this.scheduleRefresh();
      });
      const text = document.createElement('span'); text.dataset.nbinlineaiToolsNames = '';
      const state = document.createElement('span'); state.dataset.nbinlineaiToolsState = '';
      label.append(input, text, state, description);
    }
    if (label.parentElement !== line) line.append(label);
    const input = label.querySelector('input')!;
    input.checked = aiCell(cell).toolsInclude !== false;
    const below = this.viewTargetIndex >= 0 && (this.viewPositions.get(cell.id) ?? -1) > this.viewTargetIndex;
    const namesLabel = label.querySelector('[data-nbinlineai-tools-names]') as HTMLElement;
    namesLabel.textContent = `Tools (${names.length})`;
    const state = label.querySelector('[data-nbinlineai-tools-state]') as HTMLElement;
    state.textContent = below ? 'below' : this.viewTargetIndex < 0 ? 'later questions' : '';
    const description = label.querySelector('[data-nbinlineai-tools-description]') as HTMLElement;
    description.textContent = `Declarations: ${names.join(', ')}. ${input.checked ? 'Saved on' : 'Saved off'}. ` +
      (below ? 'Below this question; inactive here. This saved choice applies to later questions.' :
        this.viewTargetIndex < 0 ? 'Choose an AI question to see whether these declarations are available.' :
          'At or above this question; enabled declarations can be offered. This choice is separate from notebook text context.');
    input.title = description.textContent;
    label.title = description.textContent;
  }
}
