// ==UserScript==
// @name         Grok Tab Status
// @name:zh-TW   Grok 分頁狀態
// @name:zh-CN   Grok 标签页状态
// @namespace    https://github.com/endman100
// @version      0.1.0
// @description  Show Grok execution state in the browser tab title.
// @description:zh-TW 在瀏覽器分頁標題顯示 Grok 的 IDLE / THINKING / TOOL / WRITING / DONE 執行狀態。
// @description:zh-CN 在浏览器标签页标题显示 Grok 的 IDLE / THINKING / TOOL / WRITING / DONE 执行状态。
// @author       endman100
// @homepageURL  https://github.com/endman100/grok-tab-status
// @supportURL   https://github.com/endman100/grok-tab-status/issues
// @match        https://grok.com/*
// @match        https://*.grok.com/*
// @match        https://grok.x.ai/*
// @match        https://x.com/i/grok*
// @match        https://x.com/i/grok/*
// @icon         https://grok.com/images/favicon-light.png
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const PREFIX_RE = /^\[(?:THINKING|TOOL|WRITING|DONE|IDLE)\]\s*/;
  const POLL_MS = 250;
  const ACTIVITY_LATCH_MS = 2500;

  const STOP_SELECTORS = [
    'button[data-testid="chat-stop"]',
    'button[data-testid="chat-stop-button"]',
    'button[aria-label="Stop"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop response"]',
    'button[aria-label*="Stop generating" i]',
    'button[aria-label*="Stop response" i]',
    'button[aria-label*="停止"]',
    'button[title*="Stop generating" i]',
    'button[title*="停止生成"]'
  ];

  const USER_SELECTORS = [
    '[data-testid="user-message"]',
    '[data-testid="user-turn"]',
    '.message-bubble.user',
    '[id^="response-"].items-end',
    '[id^="response-"][class*="items-end"]'
  ];

  const ASSISTANT_SELECTORS = [
    '[data-testid="assistant-message"]',
    '[data-testid="assistant-turn"]',
    '.message-bubble.assistant',
    '[id^="response-"].items-start',
    '[id^="response-"][class*="items-start"]'
  ];

  const THINKING_TEXT_RE =
    /(?:思考中|正在思考|正在推理|推理中|Thinking(?!\s+of)|Reasoning|Worked for|Thought for|Thinking for)/i;

  const FINISHED_THINKING_RE =
    /(?:Thought for|Worked for|思考了|推理了)\s*\d+/i;

  const TOOL_TEXT_RE =
    /(?:正在搜尋|搜尋網頁|搜尋中|已搜尋|瀏覽網頁|正在瀏覽|正在搜索|搜索中|Search(?:ed|ing)?(?: the)? web|Browsing(?: the)? web|Using tool|Calling tool|Tool call|Web search|Searching|Looking up|Reading page|Opening page|Connector|Sources?|來源|引用來源)/i;

  const TOOL_ATTR_RE = /(?:tool|search|browse|browser|connector|plugin|source)/i;

  let baseTitle = stripPrefix(document.title) || 'Grok';
  let lastState = '';
  let toolLatchUntil = 0;
  let thinkingLatchUntil = 0;

  function stripPrefix(value) {
    return String(value || '').replace(PREFIX_RE, '').trim();
  }

  function currentBaseTitle() {
    const raw = stripPrefix(document.title);
    if (raw && raw !== baseTitle && raw !== 'Grok') baseTitle = raw;
    return baseTitle || 'Grok';
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryAll(selectors, root = document) {
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = [...root.querySelectorAll(selector)];
      } catch {
        continue;
      }
      for (const node of nodes) {
        if (!seen.has(node)) {
          seen.add(node);
          out.push(node);
        }
      }
    }
    return out;
  }

  function isStopControl(el) {
    if (!el) return false;
    const testId = el.getAttribute('data-testid') || '';
    if (testId === 'chat-stop' || testId === 'chat-stop-button') return true;
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
    if (/(?:Stop generating|Stop response|停止生成|停止回應|停止响应)/i.test(label)) return true;
    if (/^Stop$/i.test((el.getAttribute('aria-label') || '').trim())) {
      return Boolean(
        el.closest('[data-testid="chat-input"]') ||
        el.closest('form')?.querySelector('[data-testid="chat-input"], textarea[aria-label="Ask Grok anything"]')
      );
    }
    return false;
  }

  function running() {
    const stops = queryAll(STOP_SELECTORS).filter((el) => isStopControl(el) && visible(el));
    if (stops.length) return true;
    const streaming = document.querySelector('[data-streaming="true"], [data-is-streaming="true"]');
    if (streaming && visible(streaming)) return true;
    return false;
  }

  function authoredMessages() {
    const users = queryAll(USER_SELECTORS);
    const assistants = queryAll(ASSISTANT_SELECTORS);
    const merged = [...users, ...assistants].filter((el, i, arr) => arr.indexOf(el) === i);
    merged.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return merged;
  }

  function roleOf(node) {
    const testId = (node.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('user')) return 'user';
    if (testId.includes('assistant')) return 'assistant';
    const cls = String(node.className || '');
    if (/\buser\b|items-end/.test(cls)) return 'user';
    if (/\bassistant\b|items-start/.test(cls)) return 'assistant';
    if (node.matches?.('[data-testid="user-message"], [data-testid="user-turn"]')) return 'user';
    if (node.matches?.('[data-testid="assistant-message"], [data-testid="assistant-turn"]')) return 'assistant';
    return '';
  }

  function latestRole() {
    const nodes = authoredMessages();
    return nodes.length ? roleOf(nodes[nodes.length - 1]) : '';
  }

  function latestAssistantNode() {
    const nodes = authoredMessages();
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (roleOf(nodes[i]) === 'assistant') {
        const node = nodes[i];
        return (
          node.closest('[id^="response-"]') ||
          node.closest('article') ||
          node.closest('.message-bubble') ||
          node.parentElement ||
          node
        );
      }
    }
    return null;
  }

  function latestUserNode() {
    const nodes = authoredMessages();
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (roleOf(nodes[i]) === 'user') return nodes[i];
    }
    return null;
  }

  function isAfterLatestUser(el) {
    const user = latestUserNode();
    if (!user || !el) return true;
    if (el === user || user.contains(el) || el.contains(user)) return false;
    return Boolean(user.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function compactSignals(root) {
    if (!root) return '';
    return [...root.querySelectorAll(
      'button,[role="button"],[data-testid],[aria-label],summary,a[href],.thinking-container,[class*="think"],[class*="search"],[class*="tool"]'
    )]
      .slice(-180)
      .map((el) => [
        el.getAttribute('data-testid') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('href') || '',
        el.className || '',
        el.innerText || ''
      ].join(' '))
      .join('\n');
  }

  function hasToolState(root) {
    if (!root) return false;
    const selector = [
      '[data-testid*="tool" i]',
      '[data-testid*="search" i]',
      '[data-testid*="browse" i]',
      '[data-testid*="browser" i]',
      '[data-testid*="connector" i]',
      '[data-testid*="plugin" i]',
      '[data-testid*="web-search" i]',
      '[class*="tool-call"]',
      '[class*="web-search"]'
    ].join(',');
    if (root.querySelector(selector)) return true;
    return TOOL_TEXT_RE.test(compactSignals(root));
  }

  function hasThinkingState(root) {
    if (!root) return false;
    const thinkingUi = root.querySelector(
      '.thinking-container, [data-testid*="reason" i], [data-testid*="think" i], [class*="thinking"]'
    );
    if (thinkingUi && visible(thinkingUi)) {
      const text = thinkingUi.innerText || '';
      if (!FINISHED_THINKING_RE.test(text) || /Thinking(?!\s+of)/i.test(text)) {
        if (THINKING_TEXT_RE.test(text) || thinkingUi.classList.contains('thinking-container')) {
          if (!FINISHED_THINKING_RE.test(text) || running()) return true;
        }
      }
    }
    const signals = compactSignals(root);
    if (FINISHED_THINKING_RE.test(signals) && !/\bThinking\b/.test(signals)) return false;
    return THINKING_TEXT_RE.test(signals) && !FINISHED_THINKING_RE.test(signals);
  }

  function assistantHasAnswerText(root) {
    if (!root) return false;
    const markdown =
      root.querySelector('.response-content-markdown, [class*="response-content"], .prose') ||
      root;
    const text = String(markdown.innerText || markdown.textContent || '')
      .replace(/Grok\s*(?:說|said)\s*[:：]?/gi, '')
      .replace(THINKING_TEXT_RE, '')
      .replace(FINISHED_THINKING_RE, '')
      .replace(TOOL_TEXT_RE, '')
      .replace(/處理時間為\s*\d+\s*s/gi, '')
      .trim();
    return text.length >= 2;
  }

  function isStreaming(root) {
    if (!root) {
      return Boolean(document.querySelector('[data-streaming="true"], [data-is-streaming="true"]'));
    }
    return Boolean(
      root.matches?.('[data-streaming="true"], [data-is-streaming="true"]') ||
      root.querySelector('[data-streaming="true"], [data-is-streaming="true"]')
    );
  }

  function nodeBlob(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return '';
    return [
      el.getAttribute?.('data-testid') || '',
      el.getAttribute?.('aria-label') || '',
      el.getAttribute?.('href') || '',
      el.className || '',
      el.innerText || el.textContent || ''
    ].join(' ').slice(0, 2400);
  }

  function scanMutationNode(node) {
    if (!running()) return;
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return;
    if (el.closest?.('nav, aside, [data-sidebar-item], header')) return;
    if (!isAfterLatestUser(el)) return;
    const blob = nodeBlob(el);
    const structuralSignal = [
      el.getAttribute?.('data-testid') || '',
      el.getAttribute?.('aria-label') || '',
      el.getAttribute?.('role') || '',
      el.className || ''
    ].join(' ');
    if (TOOL_ATTR_RE.test(structuralSignal) || TOOL_TEXT_RE.test(blob)) {
      toolLatchUntil = Date.now() + ACTIVITY_LATCH_MS;
      return;
    }
    if (THINKING_TEXT_RE.test(blob) && !FINISHED_THINKING_RE.test(blob)) {
      thinkingLatchUntil = Date.now() + ACTIVITY_LATCH_MS;
    }
  }

  function detectState() {
    const assistant = latestAssistantNode();
    if (running()) {
      if (Date.now() < toolLatchUntil || hasToolState(assistant)) {
        if (hasToolState(assistant) || Date.now() < toolLatchUntil) return 'TOOL';
      }
      if (latestRole() !== 'assistant') return 'THINKING';
      if (
        Date.now() < thinkingLatchUntil ||
        hasThinkingState(assistant) ||
        !assistantHasAnswerText(assistant)
      ) {
        return 'THINKING';
      }
      if (isStreaming(assistant) || assistantHasAnswerText(assistant)) return 'WRITING';
      return 'THINKING';
    }
    if (assistant) return 'DONE';
    return 'IDLE';
  }

  function applyState() {
    const state = detectState();
    const title = `[${state}] ${currentBaseTitle()}`;
    document.documentElement.dataset.grokTabStatus = state;
    document.documentElement.dataset.grokTabStatusVersion = VERSION;
    if (document.title !== title) document.title = title;
    if (state !== lastState) {
      lastState = state;
      console.debug('[Grok Tab Status]', state);
    }
    return state;
  }

  let debounceTimer = 0;
  const observer = new MutationObserver((mutations) => {
    if (running()) {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) scanMutationNode(node);
      }
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyState, 30);
  });

  function start() {
    const root = document.body || document.documentElement;
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-state',
        'data-testid',
        'data-streaming',
        'data-is-streaming',
        'aria-label',
        'aria-expanded',
        'href',
        'class'
      ]
    });
    setInterval(applyState, POLL_MS);
    applyState();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  window.__grokTabStatus = {
    version: VERSION,
    detectState,
    refresh: applyState
  };
})();
