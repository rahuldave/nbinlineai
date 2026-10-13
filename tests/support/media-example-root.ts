/** Answer the public server-root prompt only in a disposable E2E notebook copy. */
export function useOwnedServerRoot(
  notebook: { cells: Array<{ id: string; cell_type: string; source: string | string[] }> },
  setupId: string
): void {
  const setup = notebook.cells.find(cell => cell.id === setupId && cell.cell_type === 'code');
  if (!setup) throw new Error(`Missing media setup cell: ${setupId}`);
  const source = Array.isArray(setup.source) ? setup.source.join('') : setup.source;
  const prompt = "input('Absolute Jupyter server root (the folder served by JupyterLab): ')";
  if (source.split(prompt).length !== 2) throw new Error(`Expected one server-root prompt in ${setupId}`);
  const answer = "__import__('os').environ['NBINLINEAI_E2E_SERVER_ROOT']";
  const updated = source.replace(prompt, answer);
  setup.source = Array.isArray(setup.source) ? updated.split(/(?<=\n)/) : updated;
}
