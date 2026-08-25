/**
 * Code128 Barcode — lightweight SVG renderer + product barcode generator.
 *
 * Code128 supports ASCII 0–127. We only encode uppercase + digits + dash,
 * which is more than enough for product barcodes.
 */

const BarcodeDetectorClass: any = (typeof globalThis !== "undefined" && (globalThis as any).BarcodeDetector) ?? null;

// ─── Code128 encoding tables ────────────────────────────────────────────────

const CODE128_PATTERNS: string[] = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100","11000111010","11010111000",
];

const START_CODE_A = 103;
const START_CODE_B = 104;
const START_CODE_C = 105;
const STOP_PATTERN = "11000111011"; // 106

function charToCode128B(ch: string): number {
  const code = ch.charCodeAt(0);
  return code - 32; // Code128B: space(32) → 0, tilde(126) → 94
}

function encodeCode128B(text: string): string {
  if (text.length === 0) return "";

  let checksum = START_CODE_B;
  let bits = CODE128_PATTERNS[START_CODE_B];

  for (let i = 0; i < text.length; i++) {
    const code = charToCode128B(text[i]);
    checksum += code * (i + 1);
    bits += CODE128_PATTERNS[code];
  }

  checksum = checksum % 103;
  bits += CODE128_PATTERNS[checksum];
  bits += STOP_PATTERN;

  return bits;
}

// ─── SVG Renderer ───────────────────────────────────────────────────────────

export function barcodeToSvg(
  text: string,
  options?: { height?: number; showText?: boolean; width?: number }
): string {
  const height = options?.height ?? 60;
  const showText = options?.showText ?? true;
  const bits = encodeCode128B(text);

  const barCount = bits.length;
  const barWidth = options?.width ? options.width / barCount : 2;
  const svgWidth = barCount * barWidth;
  const textHeight = showText ? 16 : 0;
  const svgHeight = height + textHeight;

  let rects = "";
  for (let i = 0; i < barCount; i++) {
    if (bits[i] === "1") {
      rects += `<rect x="${i * barWidth}" y="0" width="${barWidth}" height="${height}" fill="#000"/>`;
    }
  }

  const textEl = showText
    ? `<text x="${svgWidth / 2}" y="${svgHeight - 2}" text-anchor="middle" font-family="monospace" font-size="12" fill="#000">${text}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">${rects}${textEl}</svg>`;
}

// ─── Product Barcode Generator ──────────────────────────────────────────────

/**
 * Auto-generate a unique barcode for a product.
 * Format: AGS-{4-char-hash}-{sequence}
 * Example: AGS-HMSK-01
 */
export function generateProductBarcode(productName: string, index: number = 1): string {
  const hash = productName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    .padEnd(4, "X");

  const seq = String(index).padStart(2, "0");
  return `AGS-${hash}-${seq}`;
}

// ─── Camera Scanner ─────────────────────────────────────────────────────────

export interface ScanResult {
  barcode: string;
  format: string;
}

/**
 * Open camera and scan for barcodes.
 * Uses Capacitor MLKit on native devices, BarcodeDetector on web.
 * Returns the first detected barcode, or null if the user cancels.
 */
export async function scanFromCamera(): Promise<ScanResult | null> {
  // Try Capacitor MLKit first (works on Android/iOS native)
  try {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    
    // Check if available on this device
    const supported = await BarcodeScanner.isSupported();
    if (supported) {
      // Request camera permission
      const permission = await BarcodeScanner.requestPermissions();
      if (permission.camera !== "granted") {
        return null;
      }

      // Start scanning
      const { BarcodeFormat } = await import("@capacitor-mlkit/barcode-scanning");
      const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.Code128, BarcodeFormat.Code39, BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE],
      });

      if (result.barcodes.length > 0) {
        const barcode = result.barcodes[0];
        return {
          barcode: barcode.rawValue ?? '',
          format: barcode.format ?? 'UNKNOWN',
        };
      }
      return null;
    }
  } catch {
    // Capacitor MLKit not available, fall through to web method
  }

  // Fallback: Browser BarcodeDetector API (web)
  if (!BarcodeDetectorClass) {
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;

    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    const detector = new BarcodeDetectorClass({
      formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"],
    });

    const result = await new Promise<ScanResult | null>((resolve) => {
      let scanning = true;
      const stop = () => {
        scanning = false;
        stream.getTracks().forEach((t) => t.stop());
        resolve(null);
      };

      const timeout = setTimeout(stop, 30_000);

      const scanLoop = async () => {
        if (!scanning) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            clearTimeout(timeout);
            scanning = false;
            stream.getTracks().forEach((t) => t.stop());
            resolve({
              barcode: barcodes[0].rawValue,
              format: barcodes[0].format,
            });
            return;
          }
        } catch {}
        if (scanning) requestAnimationFrame(scanLoop);
      };

      scanLoop();
    });

    return result;
  } catch {
    return null;
  }
}

/**
 * Manual barcode entry — for USB scanners that act as keyboard input
 * or when camera is not available.
 */
export function createScannerInputHandler(
  onScan: (barcode: string) => void,
  options?: { prefix?: string; suffix?: string; minLength?: number }
): (e: KeyboardEvent) => void {
  const prefix = options?.prefix ?? "";
  const suffix = options?.suffix ?? "\n";
  const minLength = options?.minLength ?? 3;
  let buffer = "";
  let lastTime = Date.now();

  return (e: KeyboardEvent) => {
    const now = Date.now();
    // Reset buffer if more than 100ms since last key (typing, not scanning)
    if (now - lastTime > 100) buffer = "";
    lastTime = now;

    if (e.key === "Enter") {
      const scanned = buffer.replace(suffix, "").replace(prefix, "").trim();
      if (scanned.length >= minLength) {
        onScan(scanned);
      }
      buffer = "";
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
    }
  };
}
