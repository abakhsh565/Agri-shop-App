import { useState } from "react";
import { Copy, MessageCircle, Send } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { buildInviteMessage, internationalPhone, inviteLink, smsShareUrl, whatsappShareUrl } from "@/lib/appInvite";
import { DEMO_OTP_CODE, isDemoOtpMode } from "@/lib/authMode";

/**
 * The invitation an owner hands to a new employee.
 *
 * One component, because the same thing is shown in two places — right after the
 * invitation is sent, and on the invited employee's page, where the owner comes
 * back to it because the employee has not signed in yet. Two copies of "what is
 * the link and how do I send it" would drift.
 */
export default function InviteLinkCard({ name, phone }: { name: string; phone: string }) {
  const t = useT();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [copied, setCopied] = useState(false);

  const link = inviteLink(phone);
  // The message spells the number out for a human; the share targets and the
  // link use the normalized form (see appInvite.ts).
  const message = buildInviteMessage({ name, phone: internationalPhone(phone), link, t });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The clipboard API is unavailable in some WebViews / insecure contexts.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    addToast(t("invite.copied"), "success");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--divider)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div className="px-4 pt-4 pb-3">
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          {t("invite.linkLabel")}
        </p>

        {link ? (
          <p
            className="text-[13px] font-medium mt-2 break-all select-all"
            style={{ color: "var(--text-primary)" }}
            data-testid="invite-link"
          >
            {link}
          </p>
        ) : (
          // No publicly reachable address exists (e.g. the bundled Android app).
          // Saying so is better than showing a link that cannot work.
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
            {t("invite.linkUnavailable")}
          </p>
        )}

        {isDemoOtpMode && (
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
            {t("invite.demoCode", { code: DEMO_OTP_CODE })}
          </p>
        )}
      </div>

      <div className="px-4 pb-4 flex flex-wrap gap-2">
        {link && (
          <button
            onClick={() => copy(link)}
            className="h-10 px-4 rounded-full text-xs font-bold flex items-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
            data-testid="invite-copy"
          >
            <Copy size={14} />
            {copied ? t("invite.copied") : t("invite.copyLink")}
          </button>
        )}
        <a
          href={whatsappShareUrl(phone, message)}
          target="_blank"
          rel="noopener noreferrer"
          className="h-10 px-4 rounded-full text-xs font-bold flex items-center gap-2"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
          data-testid="invite-whatsapp"
        >
          <MessageCircle size={14} />
          {t("invite.shareWhatsApp")}
        </a>
        <a
          href={smsShareUrl(phone, message)}
          className="h-10 px-4 rounded-full text-xs font-bold flex items-center gap-2"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          data-testid="invite-sms"
        >
          <Send size={14} />
          {t("invite.shareSms")}
        </a>
      </div>
    </div>
  );
}
