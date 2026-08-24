"use client";

import { useEffect, useRef, useState } from "react";
import { getHelpCopy, normalizeHelpLocale } from "./helpI18n";

let nextMessageId = 1;

export default function HelpChatbot({
  initialContext,
  initialLocale,
  initialTheme,
}) {
  const locale = normalizeHelpLocale(initialLocale);
  const copy = getHelpCopy(locale);
  const [theme, setTheme] = useState(initialTheme);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(() => [
    {
      id: "welcome",
      role: "assistant",
      text: copy.chatbotWelcome,
      sources: [],
    },
  ]);
  const transcriptRef = useRef(null);

  useEffect(() => {
    const receiveMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "munetios-help-chatbot-theme") {
        setTheme(String(event.data.theme || "account"));
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      behavior: "smooth",
      top: transcriptRef.current.scrollHeight,
    });
  });

  const sendPrompt = async (event) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || sending) return;
    const userMessage = {
      id: `message-${nextMessageId++}`,
      role: "user",
      text: value,
      sources: [],
    };
    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    setSending(true);
    try {
      const request = await fetch("/api/help/chatbot", {
        body: JSON.stringify({ context: initialContext, prompt: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await request.json().catch(() => ({}));
      if (!request.ok) throw new Error(payload.error || "request_failed");
      setMessages((current) => [
        ...current,
        {
          id: `message-${nextMessageId++}`,
          role: "assistant",
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          text: payload.answer || copy.chatbotNoAnswer,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `message-${nextMessageId++}`,
          role: "assistant",
          sources: [],
          text:
            error.message === "rate_limited"
              ? copy.chatbotRateLimited
              : copy.chatbotFailed,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="help-chatbot-page" data-help-theme={theme}>
      <header className="help-chatbot-header liquid-glass">
        <span className="help-chatbot-mark">
          <icon>smart_toy</icon>
        </span>
        <span>
          <strong>{copy.chatbotAssistant}</strong>
          <small>{copy.chatbotGrounded}</small>
        </span>
        <button
          aria-label={copy.chatbotClose}
          onClick={() =>
            window.parent.postMessage(
              { type: "munetios-help-chatbot-close" },
              window.location.origin,
            )
          }
          type="button"
        >
          <icon>close</icon>
        </button>
      </header>
      <div
        aria-live="polite"
        className="help-chatbot-transcript"
        ref={transcriptRef}
      >
        {messages.map((message) => (
          <article
            className={`help-chatbot-message is-${message.role}`}
            key={message.id}
          >
            <span>
              {message.role === "assistant"
                ? copy.chatbotAssistant
                : copy.chatbotYou}
            </span>
            <p>{message.text}</p>
            {message.sources.length
              ? <div className="help-chatbot-sources">
                  {message.sources.map((source) => (
                    <a href={source.href} key={source.href} target="_parent">
                      {source.label}
                    </a>
                  ))}
                </div>
              : null}
          </article>
        ))}
        {sending
          ? <output className="help-chatbot-thinking">
              <span />
              <span />
              <span />
              <span className="sr-only">{copy.chatbotThinking}</span>
            </output>
          : null}
      </div>
      <form
        className="help-chatbot-composer liquid-glass"
        onSubmit={sendPrompt}
      >
        <label className="sr-only" htmlFor="help-chatbot-prompt">
          {copy.chatbotPrompt}
        </label>
        <input
          id="help-chatbot-prompt"
          maxLength={1000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={copy.chatbotPlaceholder}
          type="text"
          value={prompt}
        />
        <button
          aria-label={copy.chatbotSend}
          disabled={!prompt.trim() || sending}
          type="submit"
        >
          <icon>arrow_upward</icon>
        </button>
      </form>
      <p className="help-chatbot-disclaimer">{copy.chatbotDisclaimer}</p>
    </main>
  );
}
