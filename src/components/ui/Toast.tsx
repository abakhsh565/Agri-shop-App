import { useUIStore } from "@/stores/uiStore";
import { X } from "lucide-react";

export default function ToastContainer() {
  const { toasts, removeToast } = useUIStore();

  if (!toasts.length) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[calc(100%-32px)] max-w-sm" style={{ bottom: "calc(var(--tabbar-height, 72px) + 16px)" }}>
      {toasts.map((t) => {
        const styles = {
          success: "bg-black text-white",
          error: "bg-[#ef4444] text-white",
          warning: "bg-[#f59e0b] text-white",
          info: "bg-black text-white",
        };
        return (
          <div
            key={t.id}
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium ${styles[t.type]}`}
          >
            <span>{t.message}</span>
            <button onClick={() => removeToast(t.id)} className="shrink-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
