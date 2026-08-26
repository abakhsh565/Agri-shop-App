import { useState } from "react";
import { scanFromCamera } from "@/lib/barcode";
import { useUIStore } from "@/stores/uiStore";
import { Scan, X, Keyboard } from "lucide-react";

interface ScanButtonProps {
  onScan: (barcode: string) => void;
  label?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Reusable barcode scan button.
 * - Tap → tries camera first (BarcodeDetector API)
 * - If camera unavailable → shows manual entry input
 * - Also handles USB scanner keyboard input when focused
 */
export default function ScanButton({ onScan, label = "Scan", size = "md" }: ScanButtonProps) {
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const { addToast } = useUIStore();

  async function handleScan() {
    setScanning(true);
    try {
      const result = await scanFromCamera();
      if (result) {
        onScan(result.barcode);
      } else {
        // Camera not available or permission denied — show manual entry
        addToast("Camera not available. Enter barcode manually.", "warning");
        setShowManual(true);
      }
    } catch (err) {
      addToast("Camera error: " + (err instanceof Error ? err.message : "Use manual entry"), "error");
      setShowManual(true);
    } finally {
      setScanning(false);
    }
  }

  function handleManualSubmit() {
    if (manualCode.trim().length >= 3) {
      onScan(manualCode.trim());
      setManualCode("");
      setShowManual(false);
    }
  }

  const sizeClasses = {
    sm: "h-8 px-3 text-xs gap-1.5",
    md: "h-10 px-4 text-sm gap-2",
    lg: "h-12 px-5 text-sm gap-2",
  };

  return (
    <>
      <button
        onClick={handleScan}
        disabled={scanning}
        className={`flex items-center justify-center rounded-full font-medium transition-all active:scale-[0.97] disabled:opacity-50 ${sizeClasses[size]}`}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
      >
        <Scan size={size === "sm" ? 13 : 15} />
        {scanning ? "Scanning…" : label}
      </button>

      {/* Manual entry modal */}
      {showManual && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowManual(false)}
        >
          <div
            className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Enter Barcode</p>
              <button onClick={() => setShowManual(false)}>
                <X size={18} style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Keyboard size={16} style={{ color: "var(--text-secondary)" }} />
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Type or scan barcode with USB scanner
              </p>
            </div>

            <input
              autoFocus
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualSubmit();
              }}
              placeholder="e.g. AGS-HMSK-01"
              className="w-full h-12 rounded-full px-4 text-sm outline-none font-mono"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--divider)",
                color: "var(--text-primary)",
              }}
            />

            <button
              onClick={handleManualSubmit}
              disabled={manualCode.trim().length < 3}
              className="w-full h-12 rounded-full font-bold text-sm disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              Look up product
            </button>
          </div>
        </div>
      )}
    </>
  );
}
