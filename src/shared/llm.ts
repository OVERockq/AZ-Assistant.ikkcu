import { retrieveContext } from "./rag";
import type { AssistantRequest, LlmProvider, ProviderConfig } from "./types";

const actionLabel: Record<AssistantRequest["action"], string> = {
  "summarize-page": "현재 페이지를 요약하고 실무적으로 중요한 포인트를 정리하세요.",
  "improve-selection": "선택된 문장을 더 완성도 높은 업무 문서 문장으로 개선하세요.",
  "review-risk": "문서나 페이지 내용의 리스크, 빠진 근거, 확인이 필요한 부분을 검토하세요.",
  "writing-guide": "이 상황에서 사용자가 작성해야 할 문서의 구조와 작성 가이드를 제시하세요.",
  "draft-update": "선택된 부분을 그대로 대체할 수 있는 개선 초안을 작성하세요.",
  custom: "사용자의 요청을 수행하세요."
};

export const providerLabels: Record<LlmProvider, string> = {
  ollama: "Ollama",
  openai: "ChatGPT / OpenAI",
  claude: "Claude",
  gemini: "Gemini"
};

export const fallbackModels: Record<LlmProvider, string[]> = {
  ollama: ["llama3.2", "llama3.1", "mistral", "qwen2.5"],
  openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
  claude: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]
};

export const listModels = async (provider: LlmProvider, config: ProviderConfig): Promise<string[]> => {
  if (provider !== "ollama" && !config.apiKey.trim()) {
    return fallbackModels[provider];
  }

  if (provider === "ollama") {
    const baseUrl = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama 모델 목록 오류 (${response.status}): ${await readError(response)}`);
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    return data.models?.map((model) => model.name).filter((name): name is string => Boolean(name)) ?? [];
  }

  if (provider === "gemini") {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.apiKey)}`
    );
    if (!response.ok) throw new Error(`Gemini 모델 목록 오류 (${response.status}): ${await readError(response)}`);
    const data = (await response.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    return (
      data.models
        ?.filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => model.name?.replace(/^models\//, ""))
        .filter((name): name is string => Boolean(name)) ?? []
    );
  }

  if (provider === "claude") {
    const baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      }
    });
    if (!response.ok) throw new Error(`Claude 모델 목록 오류 (${response.status}): ${await readError(response)}`);
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return data.data?.map((model) => model.id).filter((id): id is string => Boolean(id)) ?? [];
  }

  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }
  });
  if (!response.ok) throw new Error(`OpenAI 모델 목록 오류 (${response.status}): ${await readError(response)}`);
  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  return data.data?.map((model) => model.id).filter((id): id is string => Boolean(id)).sort() ?? [];
};

const buildPrompt = (request: AssistantRequest): string => {
  const contextQuery = [
    request.prompt,
    request.pageContext.selectedText,
    request.pageContext.title,
    request.pageContext.surroundingText
  ].join("\n");
  const ragContext = retrieveContext(request.assistant, contextQuery).join("\n\n---\n\n");

  return [
    `Assistant 이름: ${request.assistant.name}`,
    `Assistant 설명: ${request.assistant.description}`,
    "",
    "[Assistant 지침]",
    request.assistant.systemInstruction,
    "",
    "[관련 참고 문서]",
    ragContext || "관련 참고 문서 없음",
    "",
    "[현재 페이지]",
    `제목: ${request.pageContext.title}`,
    `URL: ${request.pageContext.url}`,
    `편집 가능 영역: ${request.pageContext.editable ? request.pageContext.editableKind : "없음"}`,
    "",
    "[선택된 텍스트]",
    request.pageContext.selectedText || "선택된 텍스트 없음",
    "",
    "[주변 텍스트]",
    request.pageContext.surroundingText || "주변 텍스트 없음",
    "",
    "[작업]",
    actionLabel[request.action],
    "",
    "[사용자 요청]",
    request.prompt || "위 작업을 수행하세요.",
    "",
    "한국어로 답하세요. 선택영역 업데이트용 결과라면 설명보다 교체 가능한 본문을 먼저 제시하세요."
  ].join("\n");
};

const requireKey = (provider: LlmProvider, config: ProviderConfig) => {
  if (provider !== "ollama" && !config.apiKey.trim()) {
    throw new Error(`${providerLabels[provider]} API 키가 설정되어 있지 않습니다.`);
  }
};

const readError = async (response: Response) => {
  const errorText = await response.text();
  return errorText.slice(0, 300);
};

const ollamaHint = (status: number) =>
  status === 403
    ? " Ollama가 Chrome 확장 origin을 차단했을 수 있습니다. OLLAMA_ORIGINS=chrome-extension://* 설정 후 Ollama를 재시작하세요."
    : "";

const callGemini = async (config: ProviderConfig, prompt: string): Promise<string> => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      config.model
    )}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, topP: 0.9 }
      })
    }
  );

  if (!response.ok) throw new Error(`Gemini API 오류 (${response.status}): ${await readError(response)}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
};

const callOllama = async (config: ProviderConfig, prompt: string) => {
  const baseUrl = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      options: { temperature: 0.4 }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API 오류 (${response.status}): ${await readError(response)}${ollamaHint(response.status)}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return data.message?.content?.trim() ?? "";
};

const callOpenAiCompatible = async (config: ProviderConfig, prompt: string) => {
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4
    })
  });

  if (!response.ok) throw new Error(`ChatGPT / OpenAI API 오류 (${response.status}): ${await readError(response)}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
};

const callClaude = async (config: ProviderConfig, prompt: string) => {
  const baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2048,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Claude API 오류 (${response.status}): ${await readError(response)}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("").trim() ?? "";
};

export const callLlm = async (
  provider: LlmProvider,
  config: ProviderConfig,
  request: AssistantRequest
): Promise<string> => {
  requireKey(provider, config);
  const prompt = buildPrompt(request);
  const text =
    provider === "gemini"
      ? await callGemini(config, prompt)
      : provider === "claude"
        ? await callClaude(config, prompt)
        : provider === "ollama"
          ? await callOllama(config, prompt)
          : await callOpenAiCompatible(config, prompt);

  if (!text) throw new Error(`${providerLabels[provider]} 응답이 비어 있습니다.`);
  return text;
};
