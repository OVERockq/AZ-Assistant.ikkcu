import type { AssistantProfile } from "./types";

type ScoredChunk = {
  text: string;
  score: number;
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);

const chunkText = (text: string): string[] => {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= 900) {
      chunks.push(paragraph);
      continue;
    }
    for (let index = 0; index < paragraph.length; index += 700) {
      chunks.push(paragraph.slice(index, index + 900));
    }
  }

  return chunks;
};

export const retrieveContext = (assistant: AssistantProfile, query: string, limit = 4): string[] => {
  const chunks = chunkText(assistant.documents);
  const queryTokens = new Set(tokenize(query));
  if (chunks.length === 0 || queryTokens.size === 0) return chunks.slice(0, limit);

  return chunks
    .map<ScoredChunk>((text) => {
      const tokens = tokenize(text);
      const score = tokens.reduce((sum, token) => sum + (queryTokens.has(token) ? 1 : 0), 0);
      return { text, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((chunk) => chunk.text);
};
