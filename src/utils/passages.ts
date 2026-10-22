/** Splits text around a passage, matching across any whitespace differences. */
export function splitAtPassage(text: string, passage: string): [string, string, string] | undefined {
  const words = passage.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return undefined;
  const match = new RegExp(words.join("\\s+")).exec(text);
  if (!match) return undefined;
  return [text.slice(0, match.index), match[0], text.slice(match.index + match[0].length)];
}
