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

  it("refuses to produce a link inside the native shell (https://localhost is unreachable by anyone else)", () => {
    stubRuntime({ origin: "https://localhost", hostname: "localhost", capacitor: true });
    expect(isNativeShell()).toBe(true);
    expect(appShareUrl()).toBeNull();
    expect(inviteLink("03001234567")).toBeNull();
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
      t,
    });
    expect(message).toContain("Bilal");
    expect(message).toContain("+923001234567");
    expect(message).toContain("https://app.agrishop.pk/login?phone=923001234567");
    expect(message).toContain("123456");
  });

  it("omits the link entirely when there is no shareable address", () => {
    const message = buildInviteMessage({ name: "Bilal", phone: "+923001234567", link: null, t });
    expect(message).not.toContain("http");
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
