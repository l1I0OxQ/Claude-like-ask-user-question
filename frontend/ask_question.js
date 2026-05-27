(function () {
  "use strict";

  // Open WebUI DOM selectors — update if Open WebUI changes markup
  const CHAT_ROOT_SELECTOR = "#messages-container";
  const ASSISTANT_SELECTOR = ".chat-assistant";
  const USER_SELECTOR = ".chat-user";
  const BLOCK_SELECTOR = ".language-ask-user-question";
  const CODE_CONTAINER_SELECTOR = ".relative.my-2";

  window.__ASK_QUESTION_JS_VERSION = "1.0.0";
  window.__scanAskUserQuestion = function () {
    console.warn("[ask-user-question] scan called before init finished");
  };

  const PROCESSED_ATTR = "data-ask-user-question-processed";
  const WIDGET_CLASS = "ask-user-question-widget";
  const READONLY_CLASS = "ask-user-question-readonly";
  const WIDGET_SESSION_ATTR = "data-ask-user-question-session";
  const WIDGET_QUESTION_ATTR = "data-ask-user-question-id";
  const CHOICE_QUESTION_ATTR = "data-question-id";
  const RESOLVED_ATTR = "data-ask-user-question-resolved";
  const SCAN_DEBOUNCE_MS = 150;
  const FALLBACK_SCAN_MS = 800;

  function escapeSelectorValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function isConnected(el) {
    return !!(el && el.isConnected);
  }

  function getChatRoot() {
    return document.querySelector(CHAT_ROOT_SELECTOR);
  }

  function queryInScope(selector, scope) {
    return scope ? [...scope.querySelectorAll(selector)] : [];
  }

  function findInScope(selector, scope) {
    const root = scope || getChatRoot();
    if (!root) {
      return null;
    }
    const el = root.querySelector(selector);
    return el && el.isConnected ? el : null;
  }

  function extractJsonText(raw) {
    const trimmed = raw.trim();
    const fromBrace = trimmed.indexOf("{");
    return fromBrace >= 0 ? trimmed.slice(fromBrace) : trimmed;
  }

  function parsePayload(block) {
    const raw = block.textContent || "";
    if (!raw.includes('"question"') || !raw.includes('"options"')) {
      return null;
    }

    try {
      const data = JSON.parse(extractJsonText(raw));
      if (
        !data ||
        typeof data.question !== "string" ||
        !Array.isArray(data.options) ||
        typeof data.session_id !== "string" ||
        typeof data.question_id !== "string"
      ) {
        return null;
      }
      return data;
    } catch (err) {
      return null;
    }
  }

  function findCodeBlockContainer(block) {
    return block.closest(CODE_CONTAINER_SELECTOR);
  }

  function hideCodeBlock(block) {
    const container = findCodeBlockContainer(block);
    if (!container) {
      return null;
    }
    container.style.display = "none";
    return container;
  }

  function findExistingWidget(questionId, chatRoot) {
    const safeId = escapeSelectorValue(questionId);
    return findInScope(
      `.${WIDGET_CLASS}[${WIDGET_QUESTION_ATTR}="${safeId}"]`,
      chatRoot
    );
  }

  function findExistingReadonlyCard(questionId, chatRoot) {
    const safeId = escapeSelectorValue(questionId);
    return findInScope(
      `.${READONLY_CLASS}[${CHOICE_QUESTION_ATTR}="${safeId}"]`,
      chatRoot
    );
  }

  function isQuestionResolvedLive(questionId, chatRoot) {
    const safeId = escapeSelectorValue(questionId);
    return !!findInScope(
      `[${RESOLVED_ATTR}="true"][${CHOICE_QUESTION_ATTR}="${safeId}"]`,
      chatRoot
    );
  }

  function markQuestionResolved(block, questionId) {
    hideCodeBlock(block);
    const container = findCodeBlockContainer(block);
    if (container) {
      container.setAttribute(RESOLVED_ATTR, "true");
      container.setAttribute(CHOICE_QUESTION_ATTR, questionId);
    }
    block.setAttribute(PROCESSED_ATTR, "true");
  }

  function findAskUserQuestionBlocks(chatRoot) {
    return queryInScope(BLOCK_SELECTOR, chatRoot || getChatRoot());
  }

  function isUserMessage(messageEl) {
    return messageEl.matches(USER_SELECTOR);
  }

  function isAssistantMessage(messageEl) {
    return messageEl.matches(ASSISTANT_SELECTOR);
  }

  function getMessageText(messageEl) {
    const clone = messageEl.cloneNode(true);
    clone
      .querySelectorAll(`.${WIDGET_CLASS}, .${READONLY_CLASS}`)
      .forEach((el) => el.remove());
    return (clone.textContent || "").trim();
  }

  function collectOrderedMessages(chatRoot) {
    const messageSet = new Set();
    queryInScope(ASSISTANT_SELECTOR, chatRoot).forEach((el) => messageSet.add(el));
    queryInScope(USER_SELECTOR, chatRoot).forEach((el) => messageSet.add(el));

    return [...messageSet].sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
      return 0;
    });
  }

  function buildMessageContext(chatRoot) {
    const messages = collectOrderedMessages(chatRoot);
    const contextByQuestionId = new Map();
    let lastAssistantWithAskIndex = -1;
    let lastAssistantWithAskQuestionId = null;

    messages.forEach((messageEl, index) => {
      if (!isAssistantMessage(messageEl)) {
        return;
      }

      const blocks = findAskUserQuestionBlocks(chatRoot).filter((block) =>
        messageEl.contains(block)
      );

      blocks.forEach((block) => {
        const payload = parsePayload(block);
        if (!payload) {
          return;
        }
        const questionId = payload.question_id;
        lastAssistantWithAskIndex = index;
        lastAssistantWithAskQuestionId = questionId;

        contextByQuestionId.set(questionId, {
          block,
          payload,
          questionId,
          messageIndex: index,
          status: "pending",
          answer: null,
        });
      });
    });

    contextByQuestionId.forEach((entry, questionId) => {
      const messageIndex = entry.messageIndex;
      for (let i = messageIndex + 1; i < messages.length; i += 1) {
        const nextMessage = messages[i];
        if (isUserMessage(nextMessage)) {
          entry.status = "resolved";
          entry.answer = getMessageText(nextMessage);
          return;
        }
        if (isAssistantMessage(nextMessage)) {
          break;
        }
      }

      if (
        messageIndex === lastAssistantWithAskIndex &&
        questionId === lastAssistantWithAskQuestionId
      ) {
        entry.status = "pending";
      } else {
        entry.status = "resolved";
      }
    });

    return { contextByQuestionId };
  }

  function getOrderedBlockEntries(chatRoot) {
    const scope = chatRoot || getChatRoot();
    if (!scope) {
      return [];
    }

    const { contextByQuestionId } = buildMessageContext(scope);

    return findAskUserQuestionBlocks(scope)
      .map((block) => {
        const payload = parsePayload(block);
        if (!payload) {
          return null;
        }
        const questionId = payload.question_id;
        const contextEntry = contextByQuestionId.get(questionId);
        return {
          block,
          payload,
          questionId,
          status: contextEntry?.status || "pending",
          answer: contextEntry?.answer || null,
        };
      })
      .filter(Boolean);
  }

  function isWidgetAnchored(widget, block) {
    if (!isConnected(widget) || !isConnected(block)) {
      return false;
    }
    const container = findCodeBlockContainer(block);
    return isConnected(container) && widget.previousElementSibling === container;
  }

  function retireStaleWidgets(keepQuestionId, chatRoot) {
    if (!keepQuestionId) {
      return;
    }
    queryInScope(`.${WIDGET_CLASS}`, chatRoot).forEach((widget) => {
      if (widget.getAttribute(RESOLVED_ATTR) === "true") {
        return;
      }
      const questionId = widget.getAttribute(WIDGET_QUESTION_ATTR);
      if (questionId && questionId !== keepQuestionId && isConnected(widget)) {
        widget.remove();
      }
    });
  }

  function submitViaOpenWebUI(value) {
    window.postMessage({ type: "input:prompt:submit", text: value }, window.origin);
  }

  function applyReadonlyCardStyles(card) {
    card.className = READONLY_CLASS;
    card.style.cssText = [
      "display: block",
      "width: 100%",
      "box-sizing: border-box",
      "margin: 8px 0",
      "padding: 10px 14px",
      "border: 1px solid #d0d7de",
      "border-radius: 8px",
      "background: #f6f8fa",
      "max-width: 640px",
      "font-family: system-ui, -apple-system, Segoe UI, sans-serif",
      "pointer-events: none",
    ].join(";");
  }

  function renderReadonlyCard(block, payload, questionId, options) {
    const { answer = null } = options || {};
    hideCodeBlock(block);

    const chatRoot = getChatRoot();
    const existing = findExistingReadonlyCard(questionId, chatRoot);
    if (existing && isWidgetAnchored(existing, block)) {
      block.setAttribute(PROCESSED_ATTR, "true");
      return true;
    }
    if (existing) {
      existing.remove();
    }

    const card = document.createElement("div");
    card.setAttribute(RESOLVED_ATTR, "true");
    card.setAttribute(CHOICE_QUESTION_ATTR, questionId);
    applyReadonlyCardStyles(card);

    const title = document.createElement("div");
    title.textContent = payload.question;
    title.style.cssText =
      "font-weight: 400; font-size: 0.9em; color: #57606a; line-height: 1.5; margin: 0;";
    card.appendChild(title);

    if (answer) {
      const answerEl = document.createElement("div");
      answerEl.textContent = `你的选择：${answer}`;
      answerEl.style.cssText =
        "font-size: 0.85em; color: #0969da; margin-top: 6px; line-height: 1.4;";
      card.appendChild(answerEl);
    }

    const container = findCodeBlockContainer(block);
    if (!isConnected(container)) {
      return false;
    }
    container.insertAdjacentElement("afterend", card);
    block.setAttribute(PROCESSED_ATTR, "true");
    return true;
  }

  function collapseWidgetToQuestion(widget, questionId, answer) {
    const titleEl = widget.firstChild;
    while (widget.lastChild !== titleEl) {
      widget.removeChild(widget.lastChild);
    }

    widget.className = READONLY_CLASS;
    widget.setAttribute(RESOLVED_ATTR, "true");
    widget.setAttribute(CHOICE_QUESTION_ATTR, questionId);
    widget.removeAttribute(WIDGET_QUESTION_ATTR);
    applyReadonlyCardStyles(widget);

    if (titleEl) {
      titleEl.style.cssText =
        "font-weight: 400; font-size: 0.9em; color: #57606a; line-height: 1.5; margin: 0;";
    }

    if (answer) {
      const answerEl = document.createElement("div");
      answerEl.textContent = `你的选择：${answer}`;
      answerEl.style.cssText =
        "font-size: 0.85em; color: #0969da; margin-top: 6px; line-height: 1.4;";
      widget.appendChild(answerEl);
    }
  }

  function mountWidget(widget, block) {
    const container = findCodeBlockContainer(block);
    if (!isConnected(container)) {
      return false;
    }
    container.insertAdjacentElement("afterend", widget);
    return true;
  }

  function createWidget(payload, questionId, block, chatRoot) {
    retireStaleWidgets(questionId, chatRoot);

    const widget = document.createElement("div");
    widget.className = WIDGET_CLASS;
    widget.setAttribute(WIDGET_SESSION_ATTR, payload.session_id);
    widget.setAttribute(WIDGET_QUESTION_ATTR, questionId);
    widget.style.cssText = [
      "display: block",
      "width: 100%",
      "flex: 0 0 100%",
      "box-sizing: border-box",
      "margin: 12px 0",
      "padding: 16px",
      "border: 1px solid #d0d7de",
      "border-radius: 12px",
      "background: #f6f8fa",
      "max-width: 640px",
      "font-family: system-ui, -apple-system, Segoe UI, sans-serif",
      "transition: opacity 150ms ease",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = payload.question;
    title.style.cssText = "font-weight: 600; margin-bottom: 12px; line-height: 1.5;";
    widget.appendChild(title);

    const optionsWrap = document.createElement("div");
    optionsWrap.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;";

    let submitted = false;

    function handleSubmit(value) {
      if (submitted) {
        return;
      }
      submitted = true;

      markQuestionResolved(block, questionId);
      collapseWidgetToQuestion(widget, questionId, value);
      submitViaOpenWebUI(value);
    }

    payload.options.forEach((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = option;
      btn.style.cssText = [
        "padding: 8px 12px",
        "border: 1px solid #0969da",
        "border-radius: 8px",
        "background: #ffffff",
        "color: #0969da",
        "cursor: pointer",
      ].join(";");
      btn.addEventListener("click", () => handleSubmit(option));
      optionsWrap.appendChild(btn);
    });
    widget.appendChild(optionsWrap);

    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.placeholder = "或输入其他选项，按 Enter 提交";
    customInput.style.cssText = [
      "width: 100%",
      "box-sizing: border-box",
      "padding: 8px 10px",
      "border: 1px solid #d0d7de",
      "border-radius: 8px",
    ].join(";");
    customInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      const value = customInput.value.trim();
      if (!value) {
        return;
      }
      handleSubmit(value);
    });
    widget.appendChild(customInput);

    return mountWidget(widget, block);
  }

  function processBlock(entry, chatRoot) {
    const { block, payload, questionId, status, answer } = entry;
    if (!(block instanceof HTMLElement)) {
      return false;
    }

    if (status === "resolved") {
      if (isQuestionResolvedLive(questionId, chatRoot)) {
        block.setAttribute(PROCESSED_ATTR, "true");
        hideCodeBlock(block);
        return true;
      }
      return renderReadonlyCard(block, payload, questionId, { answer });
    }

    hideCodeBlock(block);

    const existingWidget = findExistingWidget(questionId, chatRoot);
    if (existingWidget) {
      if (!isWidgetAnchored(existingWidget, block)) {
        existingWidget.remove();
        createWidget(payload, questionId, block, chatRoot);
      }
      block.setAttribute(PROCESSED_ATTR, "true");
      return true;
    }

    block.setAttribute(PROCESSED_ATTR, "true");
    return createWidget(payload, questionId, block, chatRoot);
  }

  function scan() {
    const chatRoot = getChatRoot();
    if (!chatRoot) {
      return 0;
    }

    ensureObserving();

    const entries = getOrderedBlockEntries(chatRoot);
    let processed = 0;

    entries.forEach((entry) => {
      if (processBlock(entry, chatRoot)) {
        processed += 1;
      }
    });

    return processed;
  }

  let scanTimer = null;
  let bootstrapObserver = null;
  const observedRoots = new WeakSet();

  function scheduleScan() {
    if (scanTimer) {
      clearTimeout(scanTimer);
    }
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, SCAN_DEBOUNCE_MS);
  }

  function observeChatRoot(root) {
    if (!root || observedRoots.has(root)) {
      return;
    }
    observedRoots.add(root);
    new MutationObserver(() => {
      scheduleScan();
    }).observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function ensureObserving() {
    observeChatRoot(getChatRoot());
  }

  function ensureBootstrapObserver() {
    if (bootstrapObserver) {
      return;
    }
    bootstrapObserver = new MutationObserver(scheduleScan);
    bootstrapObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function hasPendingBlocks() {
    const chatRoot = getChatRoot();
    if (!chatRoot) {
      return false;
    }
    const entries = getOrderedBlockEntries(chatRoot);
    const pendingEntry = entries.find((entry) => entry.status === "pending");
    if (!pendingEntry) {
      return false;
    }
    return (
      !isQuestionResolvedLive(pendingEntry.questionId, chatRoot) &&
      !findExistingWidget(pendingEntry.questionId, chatRoot)
    );
  }

  function bindChatSwitchListeners() {
    window.addEventListener("popstate", scheduleScan);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleScan();
      }
    });
  }

  try {
    ensureBootstrapObserver();
    bindChatSwitchListeners();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
    } else {
      scheduleScan();
    }

    setInterval(() => {
      if (hasPendingBlocks()) {
        scan();
      }
    }, FALLBACK_SCAN_MS);

    window.__scanAskUserQuestion = scan;
    console.info("[ask-user-question] initialized", window.__ASK_QUESTION_JS_VERSION);
  } catch (err) {
    console.error("[ask-user-question] init failed", err);
  }
})();
