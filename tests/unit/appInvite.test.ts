import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appShareUrl,
  buildInviteMessage,
  internationalPhone,
  inviteLink,
  isNativeShell,
  smsShareUrl,
  whatsappShareUrl,
} from "../../src/lib/appInvite";

/** Stand-in for the browser/runtime the module reads. */
function stubRuntime(opts: {
  origin?: string;
  protocol?: string;
  hostname?: string;
  capacitor?: boolean;
}) {
  const loc = {
    origin: opts.origin ?? "https://app.agrishop.pk",
    protocol: opts.protocol ?? "https:",
    hostname: opts.hostname ?? "app.agrishop.pk",
  };
  vi.stubGlobal("window", { location: loc });
  vi.stubGlobal("location", loc);
  vi.stubGlobal("Capacitor", opts.capacitor ? { isNativePlatform: () => true } : undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invitation link", () => {
  it("points at sign-in with the phone normalized to the form the field accepts", () => {
    stubRuntime({});
    expect(inviteLink("03001234567")).toBe(
      "https://app.agrishop.pk/login?phone=923001234567"
    );
    // Already-normalized and "+"-prefixed numbers must produce the same link.
    expect(inviteLink("923001234567")).toBe(
      "https://app.agrishop.pk/login?phone=923001234567"
    );
    expect(inviteLink("+92 300 1234567")).toBe(
      "https://app.agrishop.pk/login?phone=923001234567"
    );
  });

  it("falls back to the app's own scheme inside the native shell, where no https address exists", () => {
    stubRuntime({ origin: "https://localhost", hostname: "localhost", capacitor: true });
    expect(isNativeShell()).toBe(true);
    // https://localhost is unreachable by anyone else, so an https link built from it would
    // be dead on arrival. Returning null instead left the owner with nothing to hand over,
    // which is what made the installed app's invite a dead end; the scheme link opens the app.
    expect(appShareUrl()).toBeNull();
    expect(inviteLink("03001234567")).toBe("agrishop://login?phone=923001234567");
  });

  it("carries the shop into the scheme link as well", () => {
    stubRuntime({ origin: "https://localhost", hostname: "localhost", capacitor: true });
    expect(inviteLink("03001234567", "00000000-0000-0000-0000-000000000001")).toBe(
      "agrishop://login?phone=923001234567&shop=00000000-0000-0000-0000-000000000001",
    );
  });

  it("detects the Capacitor origin even without the Capacitor global", () => {
    stubRuntime({ origin: "https://localhost", hostname: "localhost" });
    expect(isNativeShell()).toBe(true);
  });
});

describe("invitation message", () => {
  const t = ((key: string, params?: Record<string, string | number>) => {
    let text = (
      {
        "invite.msgBody": "Hello {name}, you have been added. Sign in with {phone}.",
        "invite.msgShopId": "Shop ID: {shopId} — open the app and sign in.",
        "invite.msgDemoCode": "Verification code: {code}",
      } as Record<string, string>
    )[key];
    for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, String(v));
    return text;
  }) as never;

  it("carries the identity, the number, the link and the demo code", () => {
    const message = buildInviteMessage({
      name: "Bilal",
      phone: internationalPhone("03001234567"),
      link: "https://app.agrishop.pk/login?phone=923001234567",
      // A link already carries the shop; naming it again would be noise on every invitation.
      shopId: "00000000-0000-0000-0000-000000000001",
      t,
    });
    expect(message).toContain("Bilal");
    expect(message).toContain("+923001234567");
    expect(message).toContain("https://app.agrishop.pk/login?phone=923001234567");
    expect(message).toContain("123456");
    expect(message).not.toContain("Shop ID");
  });

  it("omits the link entirely when there is no shareable address", () => {
    const message = buildInviteMessage({ name: "Bilal", phone: "+923001234567", link: null, t });
    expect(message).not.toContain("http");
  });

  /**
   * The bundled Android app has no shareable address, so this is the path it uses. An
   * invitation is checked as a (shop, phone) pair before a code is spent, so a message with a
   * number and no shop is one the employee cannot complete — which is exactly what the card's
   * "send the message below instead" used to hand them.
   */
  it("carries the Shop ID when there is no link, because the pair is what gets checked", () => {
    const message = buildInviteMessage({
      name: "Bilal",
      phone: "+923001234567",
      link: null,
      shopId: "00000000-0000-0000-0000-000000000001",
      t,
    });
    expect(message).not.toContain("http");
    expect(message).toContain("00000000-0000-0000-0000-000000000001");
  });

  it("says nothing about a shop it was not given", () => {
    const message = buildInviteMessage({ name: "Bilal", phone: "+923001234567", link: null, t });
    expect(message).not.toContain("Shop ID");
  });
});

describe("share targets", () => {
  it("uses digits-only international form for WhatsApp and keeps the body encoded", () => {
    const url = whatsappShareUrl("03001234567", "line one\nline two");
    expect(url).toBe("https://wa.me/923001234567?text=line%20one%0Aline%20two");
  });

  it("uses the phone's own SMS composer", () => {
    const url = smsShareUrl("03001234567", "hi");
    expect(url.startsWith("sms:+923001234567?body=")).toBe(true);
  });
});
