export function normalizeUnknownWord(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[-'"`.,!?;:()[\]{}]+|[-'"`.,!?;:()[\]{}]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function hasExactKnowledgeMatch(result, word) {
  const normalizedWord = normalizeUnknownWord(word);
  if (!normalizedWord || !Array.isArray(result?.results)) return false;
  return result.results.some((entry) => normalizeUnknownWord(entry?.title) === normalizedWord);
}
