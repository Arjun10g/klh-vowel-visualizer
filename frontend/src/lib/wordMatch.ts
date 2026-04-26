export function normalizeWord(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replaceAll("'", "ʻ")
    .replaceAll("`", "ʻ")
    .replaceAll("’", "ʻ")
    .toLocaleLowerCase();
}

export function wordMatches(word: string, query: string): boolean {
  const q = normalizeWord(query);
  return q.length > 0 && normalizeWord(word).includes(q);
}
