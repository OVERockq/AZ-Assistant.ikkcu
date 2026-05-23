import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { fallbackModels, listModels, providerLabels } from "../shared/llm";
import { createDefaultAssistant, loadSettings, saveSettings } from "../shared/storage";
import type {
  AssistantAction,
  AssistantFeature,
  AssistantProfile,
  LlmProvider,
  ProviderConfig,
  Settings
} from "../shared/types";
import "./styles.css";

const providers: LlmProvider[] = ["ollama", "openai", "claude", "gemini"];

const featureActions: Array<{ value: AssistantAction; label: string }> = [
  { value: "custom", label: "사용자 정의" },
  { value: "summarize-page", label: "페이지 요약" },
  { value: "improve-selection", label: "선택영역 개선" },
  { value: "review-risk", label: "리스크 검토" },
  { value: "writing-guide", label: "작성 가이드" },
  { value: "draft-update", label: "업데이트 초안" }
];

type ModelState = {
  options: string[];
  loading: boolean;
  error: string;
};

const emptyModelState = (): Record<LlmProvider, ModelState> => ({
  ollama: { options: [], loading: false, error: "" },
  openai: { options: [], loading: false, error: "" },
  claude: { options: [], loading: false, error: "" },
  gemini: { options: [], loading: false, error: "" }
});

const cloneAssistant = (): AssistantProfile => {
  const assistant = createDefaultAssistant();
  return {
    ...assistant,
    name: "새 Assistant",
    description: "새 작업 목적을 입력하세요.",
    systemInstruction: "",
    documents: "",
    color: "#315f9c"
  };
};

const createFeature = (): AssistantFeature => ({
  id: crypto.randomUUID(),
  action: "custom",
  label: "새 기능",
  prompt: "요청사항을 입력하세요.",
  needsSelection: false
});

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<Record<LlmProvider, ModelState>>(emptyModelState);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const selectedAssistant = useMemo(
    () =>
      settings?.assistants.find((assistant) => assistant.id === settings.selectedAssistantId) ??
      settings?.assistants[0] ??
      null,
    [settings]
  );

  const updateSettings = (next: Settings) => {
    setSettings(next);
    setSaved(false);
  };

  const updateAssistant = (patch: Partial<AssistantProfile>) => {
    if (!settings || !selectedAssistant) return;
    updateSettings({
      ...settings,
      assistants: settings.assistants.map((assistant) =>
        assistant.id === selectedAssistant.id
          ? { ...assistant, ...patch, updatedAt: new Date().toISOString() }
          : assistant
      )
    });
  };

  const updateProvider = (provider: LlmProvider, patch: Partial<ProviderConfig>) => {
    if (!settings) return;
    updateSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          ...settings.providers[provider],
          ...patch
        }
      }
    });
  };

  const updateFeature = (featureId: string, patch: Partial<AssistantFeature>) => {
    if (!selectedAssistant) return;
    updateAssistant({
      features: selectedAssistant.features.map((feature) =>
        feature.id === featureId ? { ...feature, ...patch } : feature
      )
    });
  };

  const addFeature = () => {
    if (!selectedAssistant) return;
    updateAssistant({ features: [...selectedAssistant.features, createFeature()] });
  };

  const deleteFeature = (featureId: string) => {
    if (!selectedAssistant || selectedAssistant.features.length <= 1) return;
    updateAssistant({ features: selectedAssistant.features.filter((feature) => feature.id !== featureId) });
  };

  const loadProviderModels = async (provider: LlmProvider) => {
    if (!settings) return;
    setModels((current) => ({
      ...current,
      [provider]: { ...current[provider], loading: true, error: "" }
    }));
    try {
      const options = await listModels(provider, settings.providers[provider]);
      const nextOptions = options.length > 0 ? options : fallbackModels[provider];
      setModels((current) => ({
        ...current,
        [provider]: { options: nextOptions, loading: false, error: "" }
      }));
      if (!nextOptions.includes(settings.providers[provider].model)) {
        updateProvider(provider, { model: nextOptions[0] });
      }
    } catch (error) {
      setModels((current) => ({
        ...current,
        [provider]: {
          options: fallbackModels[provider],
          loading: false,
          error: error instanceof Error ? error.message : "모델 목록을 가져오지 못했습니다."
        }
      }));
    }
  };

  const addAssistant = () => {
    if (!settings) return;
    const assistant = cloneAssistant();
    updateSettings({
      ...settings,
      selectedAssistantId: assistant.id,
      assistants: [...settings.assistants, assistant]
    });
  };

  const deleteAssistant = () => {
    if (!settings || !selectedAssistant || settings.assistants.length <= 1) return;
    const assistants = settings.assistants.filter((assistant) => assistant.id !== selectedAssistant.id);
    updateSettings({ ...settings, assistants, selectedAssistantId: assistants[0].id });
  };

  const persist = async () => {
    if (!settings) return;
    await saveSettings(settings);
    setSaved(true);
  };

  if (!settings || !selectedAssistant) {
    return <main className="settings loading">설정을 불러오는 중...</main>;
  }

  return (
    <main className="settings">
      <header>
        <div>
          <h1>AZ-Assistant.ikkcu Settings</h1>
          <p>Assistant 지침과 참고문서를 로컬에 저장하고 Ollama 기본, 외부 LLM 보조 구성으로 실행합니다.</p>
        </div>
        <button className="primary" onClick={persist}>
          저장
        </button>
      </header>

      <section className="notice">
        기본 provider는 Ollama입니다. ChatGPT, Claude, Gemini는 API 키를 입력하면 보조 provider로 전환해 사용할 수 있습니다.
        Ollama는 브라우저 확장에서 접근 가능한 CORS 설정이 필요할 수 있습니다.
      </section>

      <section className="api-card">
        <label>
          기본 Provider
          <select
            value={settings.provider}
            onChange={(event) => updateSettings({ ...settings, provider: event.target.value as LlmProvider })}
          >
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {providerLabels[provider]}
              </option>
            ))}
          </select>
        </label>
        <div className="provider-grid">
          {providers.map((provider) => {
            const config = settings.providers[provider];
            const needsBaseUrl = provider !== "gemini";
            const keyPlaceholder =
              provider === "gemini"
                ? "AIza..."
                : provider === "openai"
                  ? "sk-..."
                  : provider === "claude"
                    ? "sk-ant-..."
                    : "Ollama는 보통 비워둡니다";
            return (
              <section key={provider} className={settings.provider === provider ? "provider-card active" : "provider-card"}>
                <div className="provider-card-title">
                  <strong>{providerLabels[provider]}</strong>
                  {settings.provider === provider ? <span>사용 중</span> : null}
                </div>
                <label>
                  모델
                  <div className="model-row">
                    <select
                      value={config.model}
                      onChange={(event) => updateProvider(provider, { model: event.target.value })}
                    >
                      {Array.from(new Set([config.model, ...models[provider].options, ...fallbackModels[provider]]))
                        .filter(Boolean)
                        .map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                    </select>
                    <button type="button" onClick={() => loadProviderModels(provider)} disabled={models[provider].loading}>
                      {models[provider].loading ? "조회 중" : "모델 조회"}
                    </button>
                  </div>
                  <input
                    value={config.model}
                    onChange={(event) => updateProvider(provider, { model: event.target.value })}
                    placeholder="드롭다운에 없으면 직접 입력"
                  />
                  {models[provider].error ? <small className="field-error">{models[provider].error}</small> : null}
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    value={config.apiKey}
                    onChange={(event) => updateProvider(provider, { apiKey: event.target.value })}
                    placeholder={keyPlaceholder}
                  />
                </label>
                {needsBaseUrl ? (
                  <label>
                    Base URL
                    <input
                      value={config.baseUrl ?? ""}
                      onChange={(event) => updateProvider(provider, { baseUrl: event.target.value })}
                      placeholder={provider === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1"}
                    />
                  </label>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>

      <section className="layout">
        <aside className="assistant-list">
          <div className="list-header">
            <strong>Assistants</strong>
            <button onClick={addAssistant}>추가</button>
          </div>
          {settings.assistants.map((assistant) => (
            <button
              key={assistant.id}
              className={assistant.id === selectedAssistant.id ? "assistant-row active" : "assistant-row"}
              onClick={() => updateSettings({ ...settings, selectedAssistantId: assistant.id })}
            >
              <span style={{ backgroundColor: assistant.color }} />
              <div>
                <strong>{assistant.name}</strong>
                <small>{assistant.description}</small>
              </div>
            </button>
          ))}
        </aside>

        <section className="editor">
          <div className="field-row">
            <label>
              이름
              <input value={selectedAssistant.name} onChange={(event) => updateAssistant({ name: event.target.value })} />
            </label>
            <label>
              색상
              <input
                type="color"
                value={selectedAssistant.color}
                onChange={(event) => updateAssistant({ color: event.target.value })}
              />
            </label>
          </div>

          <label>
            설명
            <input
              value={selectedAssistant.description}
              onChange={(event) => updateAssistant({ description: event.target.value })}
            />
          </label>

          <label>
            Assistant 지침
            <textarea
              className="large"
              value={selectedAssistant.systemInstruction}
              onChange={(event) => updateAssistant({ systemInstruction: event.target.value })}
              placeholder="이 Assistant가 어떤 역할과 말투, 판단 기준으로 답해야 하는지 입력하세요."
            />
          </label>

          <label>
            참고문서 / RAG 소스
            <textarea
              className="large"
              value={selectedAssistant.documents}
              onChange={(event) => updateAssistant({ documents: event.target.value })}
              placeholder="업무 기준, 작성 규칙, 예시 문서 등을 붙여 넣으세요. v1은 이 텍스트를 청크로 나누어 검색합니다."
            />
          </label>

          <section className="feature-editor">
            <div className="list-header">
              <strong>어시스턴트 기능</strong>
              <button type="button" onClick={addFeature}>
                기능 추가
              </button>
            </div>
            {selectedAssistant.features.map((feature, index) => (
              <section key={feature.id} className="feature-card">
                <div className="feature-card-head">
                  <strong>{index + 1}. {feature.label || "이름 없음"}</strong>
                  <button
                    type="button"
                    onClick={() => deleteFeature(feature.id)}
                    disabled={selectedAssistant.features.length <= 1}
                  >
                    삭제
                  </button>
                </div>
                <div className="field-row">
                  <label>
                    기능 이름
                    <input value={feature.label} onChange={(event) => updateFeature(feature.id, { label: event.target.value })} />
                  </label>
                  <label>
                    작업 유형
                    <select
                      value={feature.action}
                      onChange={(event) => updateFeature(feature.id, { action: event.target.value as AssistantAction })}
                    >
                      {featureActions.map((action) => (
                        <option key={action.value} value={action.value}>
                          {action.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={feature.needsSelection}
                    onChange={(event) => updateFeature(feature.id, { needsSelection: event.target.checked })}
                  />
                  영역 선택이 필요한 기능
                </label>
                <label>
                  기본 요청사항
                  <textarea
                    value={feature.prompt}
                    onChange={(event) => updateFeature(feature.id, { prompt: event.target.value })}
                    placeholder="이 기능을 선택했을 때 프롬프트에 기본으로 들어갈 요청사항을 입력하세요."
                  />
                </label>
              </section>
            ))}
          </section>

          <div className="danger-row">
            <button onClick={deleteAssistant} disabled={settings.assistants.length <= 1}>
              Assistant 삭제
            </button>
            <span>{saved ? "저장되었습니다." : "변경사항이 있으면 저장하세요."}</span>
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
