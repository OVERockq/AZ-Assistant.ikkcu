import type { AssistantFeature, AssistantProfile, ProviderSettings, Settings } from "./types";

const SETTINGS_KEY = "assistantSettings";
const LEGACY_SETTINGS_KEY = "gemBaseSettings";

const now = () => new Date().toISOString();

export const defaultAssistantFeatures = (): AssistantFeature[] => [
  {
    id: crypto.randomUUID(),
    action: "summarize-page",
    label: "페이지 요약",
    prompt: "현재 페이지의 핵심 내용을 요약해줘.",
    needsSelection: false
  },
  {
    id: crypto.randomUUID(),
    action: "improve-selection",
    label: "선택영역 개선",
    prompt: "선택한 문장을 자연스럽고 설득력 있게 보완해줘.",
    needsSelection: true
  },
  {
    id: crypto.randomUUID(),
    action: "review-risk",
    label: "리스크 검토",
    prompt: "빠진 근거, 리스크, 확인이 필요한 내용을 찾아줘.",
    needsSelection: false
  },
  {
    id: crypto.randomUUID(),
    action: "writing-guide",
    label: "작성 가이드",
    prompt: "이 문서를 더 잘 작성하기 위한 구조와 체크포인트를 알려줘.",
    needsSelection: false
  },
  {
    id: crypto.randomUUID(),
    action: "draft-update",
    label: "업데이트 초안",
    prompt: "선택 영역을 대체할 수 있는 개선 초안을 작성해줘.",
    needsSelection: true
  }
];

export const createDefaultAssistant = (): AssistantProfile => ({
  id: crypto.randomUUID(),
  name: "품의서 어시스턴트",
  description: "초안의 논리, 표현, 리스크를 보완합니다.",
  systemInstruction:
    "당신은 한국어 업무 문서 작성 보조자입니다. 사용자의 초안을 더 명확하고 설득력 있게 다듬고, 근거가 부족한 부분은 보완 질문이나 주석으로 표시하세요. 과장된 표현은 피하고 실무자가 바로 붙여 넣을 수 있는 문장으로 답하세요.",
  documents:
    "좋은 품의서는 목적, 배경, 요청사항, 기대효과, 비용/일정, 리스크와 대응방안을 명확히 포함한다.\n결재권자는 빠르게 판단할 수 있어야 하므로 핵심 결론을 앞에 둔다.",
  features: defaultAssistantFeatures(),
  color: "#123a66",
  createdAt: now(),
  updatedAt: now()
});

export const defaultProviders = (): ProviderSettings => ({
  ollama: {
    apiKey: "",
    model: "llama3.2",
    baseUrl: "http://localhost:11434"
  },
  openai: {
    apiKey: "",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1"
  },
  claude: {
    apiKey: "",
    model: "claude-3-5-haiku-latest",
    baseUrl: "https://api.anthropic.com/v1"
  },
  gemini: {
    apiKey: "",
    model: "gemini-2.5-flash"
  }
});

export const defaultSettings = (): Settings => {
  const assistant = createDefaultAssistant();
  return {
    provider: "ollama",
    providers: defaultProviders(),
    selectedAssistantId: assistant.id,
    assistants: [assistant]
  };
};

export const loadSettings = async (): Promise<Settings> => {
  const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  const saved = (result[SETTINGS_KEY] ?? result[LEGACY_SETTINGS_KEY]) as
    | (Partial<Settings> & {
        selectedGemId?: string | null;
        gems?: AssistantProfile[];
      })
    | undefined;
  const savedAssistants = saved?.assistants ?? saved?.gems;
  if (!saved || !Array.isArray(savedAssistants) || savedAssistants.length === 0) {
    const defaults = defaultSettings();
    await saveSettings(defaults);
    return defaults;
  }
  const providers = { ...defaultProviders(), ...(saved.providers ?? {}) };
  if (saved.apiKey && !providers.gemini.apiKey) {
    providers.gemini.apiKey = saved.apiKey;
  }
  const assistants = savedAssistants.map((assistant) => ({
    ...assistant,
    features:
      Array.isArray(assistant.features) && assistant.features.length > 0
        ? assistant.features
        : defaultAssistantFeatures()
  }));
  return {
    provider: saved.provider ?? "ollama",
    providers,
    selectedAssistantId: saved.selectedAssistantId ?? saved.selectedGemId ?? savedAssistants[0]?.id ?? null,
    assistants
  };
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
};

export const getSelectedAssistant = (settings: Settings): AssistantProfile | null =>
  settings.assistants.find((assistant) => assistant.id === settings.selectedAssistantId) ?? settings.assistants[0] ?? null;
