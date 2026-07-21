import { useEffect, useRef } from "react";
import type { TelegramAuthData } from "../api";

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

declare global {
  interface Window {
    // Named callback the widget invokes via its data-onauth attribute.
    __onTelegramAuth?: (user: TelegramAuthData) => void;
  }
}

// Whether a bot username is configured — callers hide the Telegram option when not.
export function telegramConfigured(): boolean {
  return Boolean(BOT_USERNAME);
}

// Renders Telegram's official Login Widget. The widget authenticates the user
// against the configured bot's domain and calls back with a signed payload,
// which the server verifies (see /auth/telegram). Requires a real bot whose
// domain is registered via @BotFather /setdomain — it won't render otherwise.
export function TelegramLoginButton({ onAuth }: { onAuth: (user: TelegramAuthData) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlerRef = useRef(onAuth);
  handlerRef.current = onAuth;

  useEffect(() => {
    const container = containerRef.current;
    if (!BOT_USERNAME || !container) return;

    window.__onTelegramAuth = (user) => handlerRef.current(user);

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-onauth", "__onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, []);

  if (!BOT_USERNAME) return null;
  return <div className="tg-login" ref={containerRef} />;
}
