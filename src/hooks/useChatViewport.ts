import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

/**
 * A conversation owns the visible viewport, not the document.
 *
 * WHY THIS IS A HOOK. On Android `100dvh` does not follow the keyboard, and focusing the input
 * can make the WebView scroll the document — dragging the top profile header away and leaving the
 * composer underneath the keyboard. The installed app measures the native keyboard inset; the
 * browser uses `visualViewport`. Both write one CSS variable, so the chat shell stays exactly as
 * tall as the part of the screen the user can actually see.
 *
 * The assistant arrived at the same rules first; keeping the measurement in one hook means the
 * two chats cannot drift apart the next time the keyboard behaviour changes.
 */
export function useChatViewport(variable = "--chat-viewport-height") {
  useEffect(() => {
    const root = document.documentElement;

    const setHeight = (height: number) => {
      const value = Math.round(height);
      if (value > 0) root.style.setProperty(variable, `${value}px`);
    };
    const resetDocumentScroll = () => {
      if (window.scrollY) window.scrollTo(0, 0);
    };

    let cleanup = () => {};

    if (Capacitor.isNativePlatform()) {
      // Android counts the navigation bar in the IME inset; the WebView already sits above it.
      const show = (info: { keyboardHeight: number }) => {
        const systemBarInset = Math.max(0, window.screen.height - window.innerHeight);
        setHeight(window.innerHeight - info.keyboardHeight + systemBarInset);
        resetDocumentScroll();
      };
      const hide = () => {
        setHeight(window.innerHeight);
        resetDocumentScroll();
      };
      const willShow = Keyboard.addListener("keyboardWillShow", show);
      const didShow = Keyboard.addListener("keyboardDidShow", show);
      const willHide = Keyboard.addListener("keyboardWillHide", hide);
      const didHide = Keyboard.addListener("keyboardDidHide", hide);
      cleanup = () => {
        void willShow.then((handle) => handle.remove());
        void didShow.then((handle) => handle.remove());
        void willHide.then((handle) => handle.remove());
        void didHide.then((handle) => handle.remove());
      };
    } else {
      const viewport = window.visualViewport;
      const sync = () => {
        setHeight(viewport?.height ?? window.innerHeight);
        resetDocumentScroll();
      };
      sync();
      viewport?.addEventListener("resize", sync);
      viewport?.addEventListener("scroll", sync);
      cleanup = () => {
        viewport?.removeEventListener("resize", sync);
        viewport?.removeEventListener("scroll", sync);
      };
    }

    setHeight(window.innerHeight);
    resetDocumentScroll();

    return () => {
      cleanup();
      root.style.removeProperty(variable);
    };
  }, [variable]);
}
