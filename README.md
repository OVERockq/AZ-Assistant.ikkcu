# AZ-Assistant.ikkcu

AZ-Assistant.ikkcu is a Chrome MV3 extension that brings configurable AI assistants into the browser side panel. Each Assistant has its own instructions, reference documents, and feature buttons. The extension can read page context, help draft or review content, and replace selected text in supported editable fields.

The default provider is Ollama, with optional support for ChatGPT/OpenAI, Claude, and Gemini through their APIs.

## What It Does

- Runs from the Chrome side panel on the page where the extension is opened.
- Lets you create multiple Assistants with different instructions and reference documents.
- Lets each Assistant define its own features, such as summary, review, rewrite, or custom workflows.
- Collects current page title, URL, selected text, and nearby text.
- Sends Assistant instructions, local reference context, page context, and the user request to the selected LLM provider.
- Renders responses as Markdown.
- Supports copying responses or replacing selected page text.

## Supported Providers

- Ollama native `/api/chat` and `/api/tags` endpoints (default)
- ChatGPT / OpenAI-compatible chat completions
- Claude Messages API
- Gemini API

Provider settings are stored in `chrome.storage.local`. This project is intended for personal or internal use. Do not publish a shared build with embedded API keys.

## Quick Install (실행파일)

별도의 Node.js / npm 설치 없이 바로 실행 가능한 설치 프로그램입니다.

| 플랫폼 | 파일명 |
|--------|--------|
| Windows x64 | `az-assistant-installer-win.exe` |
| macOS Intel | `az-assistant-installer-mac-x64` |
| macOS Apple Silicon | `az-assistant-installer-mac-arm64` |
| Linux x64 | `az-assistant-installer-linux` |

**macOS / Linux:**
```bash
chmod +x az-assistant-installer-mac-arm64
./az-assistant-installer-mac-arm64
```

**Windows:**  
`az-assistant-installer-win.exe`를 더블클릭하거나 CMD에서 실행

실행하면:
1. Extension 파일을 `~/.az-assistant/extension/` 에 자동 설치
2. Chrome을 자동 탐지하고 선택적으로 실행
3. 수동 설치 방법도 안내 (`chrome://extensions` → Load unpacked)

---

## 개발자 Setup

```bash
npm install
npm run build
```

Load the generated `dist` directory from `chrome://extensions` as an unpacked extension.

## 설치 프로그램 빌드 (실행파일 만들기)

```bash
# 모든 플랫폼 (Windows, macOS x64/arm64, Linux)
npm run build:installer

# 특정 플랫폼만
npm run build:installer:win        # Windows x64
npm run build:installer:mac-x64    # macOS Intel
npm run build:installer:mac-arm64  # macOS Apple Silicon
npm run build:installer:linux      # Linux x64
```

빌드 결과물은 `releases/` 폴더에 생성됩니다.

## Ollama Setup

Chrome extensions send requests with a `chrome-extension://...` origin. Ollama may reject that origin unless it is explicitly allowed.

On macOS with the Ollama app:

```bash
launchctl setenv OLLAMA_ORIGINS 'chrome-extension://*,http://localhost:*,http://127.0.0.1:*'
```

Then restart the Ollama app.

For a terminal-launched server:

```bash
OLLAMA_ORIGINS='chrome-extension://*,http://localhost:*,http://127.0.0.1:*' ollama serve
```

## Assistant Configuration

Open the extension options page to configure:

- Provider and model
- Assistant name, description, color
- Assistant instructions
- Reference documents used for local context retrieval
- Assistant-specific features

Each feature has:

- Feature name
- Action type
- Default prompt
- Whether selected text is required

## Usage Flow

1. Open a normal web page.
2. Click the AZ-Assistant.ikkcu extension icon.
3. Select an Assistant.
4. Select a feature.
5. Select page text if the feature needs it.
6. Edit the prompt.
7. Send the request.
8. Copy the Markdown response or update the selected text.

## Editing Support

Selection replacement is supported for:

- `input`
- `textarea`
- `contenteditable`

Complex editors such as Google Docs, Notion, iframe editors, Shadow DOM editors, and canvas-based editors may fail and will fall back to copying the generated response.

## Packaging (ZIP)

Build first:

```bash
npm run build
```

Package the extension with `dist` contents at the ZIP root:

```bash
cd dist
zip -r ../az-assistant-ikkcu.zip .
```

## Known Constraints

- Web UIs such as `gemini.google.com`, `chatgpt.com`, and `claude.ai` are not automated. The extension uses provider APIs.
- Claude direct browser access may be affected by Anthropic account or CORS policy.
- External provider API keys are stored locally in Chrome extension storage.
- Local reference retrieval is keyword/chunk based, not vector search.
