export type AssistantProfile = {
  id: string;
  name: string;
  description: string;
  systemInstruction: string;
  documents: string;
  features: AssistantFeature[];
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  apiKey?: string;
  provider: LlmProvider;
  providers: ProviderSettings;
  selectedAssistantId: string | null;
  assistants: AssistantProfile[];
};

export type LlmProvider = "gemini" | "openai" | "claude" | "ollama";

export type ProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type ProviderSettings = Record<LlmProvider, ProviderConfig>;

export type PageContext = {
  title: string;
  url: string;
  selectedText: string;
  editable: boolean;
  editableKind: "input" | "textarea" | "contenteditable" | "none";
  surroundingText: string;
};

export type AssistantAction =
  | "summarize-page"
  | "improve-selection"
  | "review-risk"
  | "writing-guide"
  | "draft-update"
  | "custom";

export type AssistantFeature = {
  id: string;
  action: AssistantAction;
  label: string;
  prompt: string;
  needsSelection: boolean;
};

export type AssistantRequest = {
  action: AssistantAction;
  prompt: string;
  assistant: AssistantProfile;
  pageContext: PageContext;
};

export type ContentRequest =
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "REPLACE_SELECTION"; text: string };

export type ReplaceResult = {
  ok: boolean;
  reason?: string;
};
