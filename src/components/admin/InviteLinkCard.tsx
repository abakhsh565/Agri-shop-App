import { useEffect, useState } from "react";
import { Copy, MessageCircle, Send } from "lucide-react";
import { useT } from "@/lib/i18n";
import { myShopJoinCode } from "@/lib/auth";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { buildInviteMessage, internationalPhone, inviteLink, smsShareUrl, whatsappShareUrl } from "@/lib/appInvite";
import { DEMO_OTP_CODE, isDemoOtpMode } from "@/lib/authMode";
import { useShopStore } from "@/stores/shopStore";

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
  // The shop goes in the link so the invitation can be checked as a (shop, phone) pair, and so
  // the invitee is told which shop invited them. Read from the store rather than asked for:
  // the invitation is always for the shop the owner is working in.
  const activeShopId = useShopStore((s) => s.activeShopId);
  const isUrdu = language === "ur";
  const [copied, setCopied] = useState(false);
  //
  // The shop's own short code, read from the database rather than computed here.
  //
  // This is the half of the invitation a person can say out loud. The link above is device-bound
  // — it lands in one app on one phone — and a raw shop id is a uuid, so neither can be passed on
  // by voice at the shop counter. The code can, which is exactly how an employee who never
  // received the message still gets onboarded.
  //
  // Re-read when the working shop changes: the code names THAT shop, so a stale one would
  // send the new employee to the wrong door.
  const [shopCode, setShopCode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setShopCode(null);
    void myShopJoinCode().then((code) => { if (alive) setShopCode(code); });
    return () => { alive = false; };
  }, [activeShopId]);

  // Prefer the short join code in the link so the employee can follow this invite
  // without needing to type or share an internal UUID.
  const link = inviteLink(phone, activeShopId, shopCode);
  // The message spells the number out for a human; the share targets and the
  // link use the normalized form (see appInvite.ts).
  const message = buildInviteMessage({
    name,
    phone: internationalPhone(phone),
    link,
    shopId: activeShopId,
    shopCode,
    t,
  });

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
      className="rounded-[var(--radius-card)] overflow-hidden"
      style={{ background: "var(--tone-card)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div className="px-4 pt-4 pb-3">
        <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
          {t("invite.linkLabel")}
        </p>
        <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }} data-testid="invite-flow-hint">
          {t("invite.flowHint")}
        </p>

        {link ? (
          <p
            className="text-13 font-medium mt-2 break-all select-all"
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

        {/* The shop code, as its own value rather than a detail buried in the link.
            An invitation is a claim about a (shop, phone) pair and the sign-in screen asks for
            both, so the moment the link cannot be used — which is every launch of the bundled
            Android app, where appShareUrl() returns null — the owner still has to be able to
            hand the employee something they can act on. The code is that thing: six characters a
            person can read out, write down or forward. */}
        {shopCode && (
          <div className="mt-3 flex items-start gap-3" data-testid="invite-shop-id">
            <div className="min-w-0 flex-1">
              <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
                {t("invite.shopIdLabel")}
              </p>
              <p
                className="text-13 font-bold mt-1 tracking-[0.18em] select-all"
                style={{ color: "var(--text-primary)", direction: "ltr", textAlign: "start" }}
                data-testid="invite-shop-id-value"
              >
                {shopCode}
              </p>
              {/* Only while the link cannot be used: with a link this is noise, without one it
                  is the whole instruction. */}
              {!link && (
                <p className="text-xs mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {t("invite.shopIdHint")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => copy(shopCode)}
              className="ds-pressable h-9 px-3 rounded-full text-12 font-bold shrink-0 flex items-center gap-1.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              data-testid="invite-copy-shop-id"
            >
              <Copy size={13} />
              {t("invite.copyShopId")}
            </button>
          </div>
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
          style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
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
