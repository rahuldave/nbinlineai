/** Textual view of one execute_request's IOPub stream. Rich output stays in the cell. */
export class ExecutionTextCollector {
  private fragments: Array<{ id?: string; text: string }> = [];
  private pendingClear = false;
  richOutputOmitted = false;

  accept(kind: string, content: Record<string, unknown>): void {
    if (kind === 'clear_output') {
      if (content.wait === true) this.pendingClear = true;
      else { this.fragments = []; this.pendingClear = false; this.richOutputOmitted = false; }
      return;
    }
    if (this.pendingClear && ['stream', 'error', 'execute_result', 'display_data', 'update_display_data'].includes(kind)) {
      this.fragments = []; this.pendingClear = false; this.richOutputOmitted = false;
    }
    let fragment = '';
    if (kind === 'stream' && typeof content.text === 'string') fragment = content.text;
    else if (kind === 'error') fragment = `${String(content.ename || 'Error')}: ${String(content.evalue || '')}\n`;
    else if (['execute_result', 'display_data', 'update_display_data'].includes(kind)) {
      const data = content.data as Record<string, unknown> | undefined;
      const plain = data?.['text/plain'];
      fragment = typeof plain === 'string' ? `${plain}\n` : '';
      if (!fragment && data && Object.keys(data).length > 0) this.richOutputOmitted = true;
    }
    if (!fragment) return;
    const transient = content.transient as Record<string, unknown> | undefined;
    const displayId = transient?.display_id;
    if (kind === 'update_display_data' && typeof displayId === 'string') {
      const index = this.fragments.findIndex(item => item.id === displayId);
      if (index >= 0) { this.fragments[index].text = fragment; return; }
    }
    this.fragments.push({ id: typeof displayId === 'string' ? displayId : undefined, text: fragment });
  }

  snapshot(limit = 8000): { text: string; truncated: boolean; rich_output_omitted: boolean } {
    const joined = this.fragments.map(item => item.text).join('');
    return { text: joined.slice(0, limit), truncated: joined.length > limit,
      rich_output_omitted: this.richOutputOmitted };
  }
}
