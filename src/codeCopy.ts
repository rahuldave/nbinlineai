/** Read only the rendered code node, never the adjacent button label. */
export async function copyCodeText(
  code: { textContent: string | null },
  writeText: (text: string) => Promise<void>
): Promise<string> {
  const text = code.textContent || '';
  await writeText(text);
  return text;
}
