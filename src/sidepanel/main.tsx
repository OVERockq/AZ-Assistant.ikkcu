import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { callLlm, providerLabels } from "../shared/llm";
import { getSelectedAssistant, loadSettings, saveSettings } from "../shared/storage";
import type { AssistantFeature, PageContext, Settings } from "../shared/types";
import "./styles.css";

type Status = "idle" | "loading" | "error" | "success";

const emptyContext: PageContext = {
  title: "",
  url: "",
  selectedText: "",
  editable: false,
  editableKind: "none",
  surroundingText: ""
};

const renderInlineMarkdown = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
};

const MarkdownView = ({ text }: { text: string }) => {
  if (!text.trim()) return <p className="empty-result">아직 생성된 응답이 없습니다.</p>;

  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(
      <pre key={`code-${blocks.length}`} className="markdown-code">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2]);
      blocks.push(
        level === 1 ? (
          <h1 key={`h-${blocks.length}`}>{content}</h1>
        ) : level === 2 ? (
          <h2 key={`h-${blocks.length}`}>{content}</h2>
        ) : (
          <h3 key={`h-${blocks.length}`}>{content}</h3>
        )
      );
      continue;
    }

    const list = line.match(/^\s*[-*]\s+(.+)$/);
    if (list) {
      listItems.push(list[1]);
      continue;
    }

    flushList();
    if (line.trim()) {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(line)}</p>);
    }
  }

  flushList();
  flushCode();

  return <div className="markdown-view">{blocks}</div>;
};

const unsupportedTabMessage =
  "이 페이지에는 접근할 수 없습니다. 일반 웹페이지를 열거나, 확장을 새로고침했다면 해당 탭도 새로고침하세요.";

const canAccessTab = (url?: string): boolean => {
  if (!url) return false;
  return /^(https?:|file:)/.test(url);
};

const sendToActiveTab = async <T,>(message: unknown): Promise<T> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("활성 탭을 찾을 수 없습니다.");
  if (!canAccessTab(tab.url)) throw new Error(unsupportedTabMessage);

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["assets/content.js"]
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
};

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pageContext, setPageContext] = useState<PageContext>(emptyContext);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("Assistant를 선택하고 페이지에서 작업을 시작하세요.");

  const selectedAssistant = useMemo(() => (settings ? getSelectedAssistant(settings) : null), [settings]);
  const assistantModes = selectedAssistant?.features ?? [];
  const selectedMode = assistantModes.find((mode) => mode.id === selectedModeId) ?? assistantModes[0] ?? null;

  const refreshSettings = async () => {
    const next = await loadSettings();
    setSettings(next);
  };

  const refreshPageContext = async () => {
    try {
      const context = await sendToActiveTab<PageContext>({ type: "GET_PAGE_CONTEXT" });
      setPageContext(context);
      setMessage(context.selectedText ? "선택 영역을 가져왔습니다." : "선택된 텍스트가 없습니다. 페이지 분석은 가능합니다.");
    } catch (error) {
      setPageContext(emptyContext);
      setMessage(error instanceof Error ? error.message : "페이지 정보를 가져오지 못했습니다.");
    }
  };

  useEffect(() => {
    refreshSettings();
    refreshPageContext();
  }, []);

  useEffect(() => {
    if (!selectedAssistant?.features.length) return;
    const mode =
      selectedAssistant.features.find((feature) => feature.id === selectedModeId) ?? selectedAssistant.features[0];
    setSelectedModeId(mode.id);
    setCustomPrompt(mode.prompt);
  }, [selectedAssistant?.id]);

  const chooseMode = async (mode: AssistantFeature) => {
    setSelectedModeId(mode.id);
    setCustomPrompt(mode.prompt);
    setResult("");
    setStatus("idle");
    setMessage(mode.needsSelection ? "필요한 영역을 선택한 뒤 요청사항을 작성하세요." : "요청사항을 작성한 뒤 보내세요.");
    if (mode.needsSelection) {
      await refreshPageContext();
    }
  };

  const runAction = async () => {
    if (!settings || !selectedAssistant || !selectedMode) return;
    if (selectedMode.needsSelection && !pageContext.selectedText.trim()) {
      await refreshPageContext();
    }
    setStatus("loading");
    setResult("");
    setMessage(`${providerLabels[settings.provider]}에 요청 중입니다.`);
    try {
      const latestContext = await sendToActiveTab<PageContext>({ type: "GET_PAGE_CONTEXT" });
      setPageContext(latestContext);
      const text = await callLlm(settings.provider, settings.providers[settings.provider], {
          action: selectedMode.action,
          prompt: customPrompt.trim() || selectedMode.prompt,
          assistant: selectedAssistant,
          pageContext: latestContext
        });
      setResult(text);
      setStatus("success");
      setMessage("응답을 생성했습니다.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.");
    }
  };

  const replaceSelection = async () => {
    if (!result.trim()) return;
    setMessage("선택 영역 업데이트 중입니다.");
    try {
      const response = await sendToActiveTab<{ ok: boolean; reason?: string }>({
        type: "REPLACE_SELECTION",
        text: result.trim()
      });
      setMessage(response.ok ? "선택 영역을 업데이트했습니다." : response.reason ?? "업데이트하지 못했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "선택 영역 업데이트에 실패했습니다.");
    }
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const selectAssistant = async (assistantId: string) => {
    if (!settings) return;
    const next = { ...settings, selectedAssistantId: assistantId };
    setSettings(next);
    await saveSettings(next);
  };

  if (!settings) {
    return <main className="shell loading">설정을 불러오는 중...</main>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="assistant-dot" style={{ backgroundColor: selectedAssistant?.color ?? "#123a66" }} />
          <div>
            <strong>AZ-Assistant.ikkcu</strong>
            <span>
              {selectedAssistant?.name ?? "Assistant 없음"} · {providerLabels[settings.provider]}
            </span>
          </div>
        </div>
        <button className="icon-button" onClick={openOptions} title="설정">
          ⚙
        </button>
      </header>

      <section className="assistant-strip" aria-label="Assistant 선택">
        {settings.assistants.map((assistant) => (
          <button
            key={assistant.id}
            className={assistant.id === selectedAssistant?.id ? "assistant-chip active" : "assistant-chip"}
            onClick={() => selectAssistant(assistant.id)}
            style={{ borderColor: assistant.color }}
          >
            <span style={{ backgroundColor: assistant.color }} />
            {assistant.name}
          </button>
        ))}
      </section>

      <section className="context-panel">
        <div>
          <strong>{pageContext.title || "현재 페이지"}</strong>
          <span>{pageContext.url}</span>
        </div>
        <button onClick={refreshPageContext}>새로고침</button>
      </section>

      <section className="mode-panel">
        <label>1. 기능 선택</label>
        <div className="actions">
          {assistantModes.map((item) => (
            <button
              key={item.id}
              className={item.id === selectedMode?.id ? "mode-button active" : "mode-button"}
              onClick={() => chooseMode(item)}
              disabled={status === "loading"}
            >
              {item.label}
            </button>
          ))}
        </div>
        <small>{selectedMode?.needsSelection ? "이 기능은 선택 영역이 있으면 더 정확합니다." : "선택 영역 없이 페이지 기준으로 실행할 수 있습니다."}</small>
      </section>

      <section className="selection-box">
        <label>2. 영역 선택</label>
        <p>{pageContext.selectedText || "페이지에서 수정할 텍스트를 선택하세요."}</p>
        <small>
          {pageContext.editable ? `${pageContext.editableKind} 업데이트 가능` : "읽기/분석만 가능하거나 선택 영역 없음"}
        </small>
      </section>

      <section className="composer">
        <label>3. 프롬프트 작성</label>
        <textarea
          value={customPrompt}
          onChange={(event) => setCustomPrompt(event.target.value)}
          placeholder="요청사항을 입력하세요."
        />
        <button
          className="primary"
          onClick={runAction}
          disabled={status === "loading" || !customPrompt.trim()}
        >
          요청 보내기
        </button>
      </section>

      <section className="result">
        <div className="result-toolbar">
          <strong>4. 응답</strong>
          <div>
            <button onClick={() => navigator.clipboard.writeText(result)} disabled={!result}>
              복사
            </button>
            <button onClick={replaceSelection} disabled={!result || status === "loading"}>
              업데이트 하기
            </button>
          </div>
        </div>
        {status === "loading" ? <p className="empty-result">생성 중...</p> : <MarkdownView text={result} />}
      </section>

      <footer className={status === "error" ? "status error" : "status"}>{message}</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
