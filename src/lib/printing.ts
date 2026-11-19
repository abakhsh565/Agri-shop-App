import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Printing on the phone.
 *
 * WHY THIS IS NOT JUST `window.print()`. The Android WebView this app ships in does not implement
 * the browser's print dialog: on the phone the button did nothing. The app therefore registers a
 * tiny native plugin (`PrinterPlugin.java`) that hands the current WebView to Android's own print
 * service, which is where the "Select a printer / Save as PDF" sheet in the owner's screenshot
 * comes from. In a browser, and in every environment without that plugin, the standard sheet is
 * still the right answer.
 *
 * A failure inside the native call falls back to the browser instead of leaving the button dead.
 */

interface PrinterPlugin {
  print(): Promise<void>;
}

const Printer = registerPlugin<PrinterPlugin>("Printer");

export async function printCurrentPage(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Printer.print();
      return;
    } catch {
      // The plugin is absent from an older build: the browser path is still worth trying.
    }
  }
  window.print();
}
