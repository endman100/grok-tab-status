# Changelog

## 0.1.1

- Detects grok.com stop button `aria-label="停止模型響應"`.
- Treats `[data-testid="canvas-working-indicator"]` (任職於 / Worked for) as an active run.

## 0.1.0

- Initial Grok port of [chatgpt-tab-status](https://github.com/endman100/chatgpt-tab-status).
- Shows IDLE, THINKING, TOOL, WRITING, and DONE in Grok tab titles.
- Detects grok.com stop controls, user/assistant turns, thinking containers, streaming flags, and tool/search labels.
- Reduces false TOOL detection caused by tool/search words in the user's own prompt.
- Ignores sidebar/navigation/header mutations for active tool detection.
- Adds short activity latches for transient THINKING/TOOL states.
- Exposes current state and script version on `document.documentElement.dataset` for diagnostics.
