# Grok Tab Status

A lightweight userscript that shows the current Grok execution state directly in the browser tab title.

Inspired by [chatgpt-tab-status](https://github.com/endman100/chatgpt-tab-status).

## States

- `[IDLE]` — no active response
- `[THINKING]` — Grok is processing before answer text is available
- `[TOOL]` — a tool / search / browser / connector activity is detected
- `[WRITING]` — answer text is streaming
- `[DONE]` — the response is complete

Examples:

```text
[THINKING] JavaScript event loop
[TOOL] JavaScript event loop
[WRITING] JavaScript event loop
[DONE] JavaScript event loop
```

## Why

When several Grok tabs are running at the same time, it is difficult to see which tab is still working without opening every tab. This script exposes that state at the tab level.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open `grok-tab-status.user.js` and install it, or use your manager's "Install from URL" with the raw file.
3. Open or reload `https://grok.com/`.

Raw install URL after the repo is published:

```text
https://raw.githubusercontent.com/endman100/grok-tab-status/main/grok-tab-status.user.js
```

## Privacy

The script runs entirely in the browser. It does not call the xAI API, does not send analytics, and does not transmit conversation content.

## Implementation

It observes the Grok page DOM with `MutationObserver`, detects UI state signals, and updates `document.title`.

Detection covers:

- Stop controls (`data-testid="chat-stop"`, stop aria-labels)
- User / assistant turns (`data-testid="user-message"`, `data-testid="assistant-message"`, `response-*` bubbles)
- Thinking UI (`.thinking-container`, Thinking / Thought for / 思考中)
- Tool / web-search labels (Searching, Browsing, Sources, 搜尋)
- Streaming flags (`data-streaming`, `data-is-streaming`)

Diagnostics are exposed on:

```js
document.documentElement.dataset.grokTabStatus
document.documentElement.dataset.grokTabStatusVersion
window.__grokTabStatus.detectState()
```

## Compatibility

Tested against the grok.com web UI selectors used by public Grok client integrations (2026). Detection includes Traditional Chinese, Simplified Chinese, and English UI signals.

Also matched on:

- `https://grok.com/*`
- `https://*.grok.com/*`
- `https://grok.x.ai/*`
- `https://x.com/i/grok*`

## Limitation

Grok's web UI is not a stable public API. DOM attributes and labels can change, so future Grok updates may require detector adjustments.

## Current version

`0.1.0`

## License

MIT
