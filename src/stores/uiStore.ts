import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface UIState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, action?: ToastAction) => void;
  removeToast: (id: string) => void;
}

// Notifications now live in the Supabase-backed `notificationStore` (a single
// live feed shared by both personas, filtered by role). This store only owns
// transient UI toasts.
export const useUIStore = create<UIState>()((set, get) => ({
  toasts: [],
  addToast: (message, type = "info", action) => {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { id, message, type, ...(action ? { action } : {}) }] });
    // An action needs enough time to be read and tapped; a plain message can go sooner.
    setTimeout(() => get().removeToast(id), action ? 6000 : 3000);
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
