import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { sendOTP, checkPhoneRegistration, resolveInvite, resolveShopCode } from "@/lib/auth";
import { internationalPhone, rememberInviteShop } from "@/lib/appInvite";
import { isDemoOtpMode } from "@/lib/authMode";
import { lastUsedProfile } from "@/lib/loginWindow";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { setPendingPhone, setPendingFlow, setIsNewDevice } = useAuthStore();

  // An invitation link carries the employee's number AND the shop that invited them, so the
  // number does not have to be typed and the claim can be checked: /login?phone=…&shop=…
  // (see lib/appInvite.ts).
  const [searchParams] = useSearchParams();
  const invitedPhone = (searchParams.get("phone") ?? "").replace(/\s/g, "");
  const inviteShopId = searchParams.get("shop") ?? "";
  // A launch that arrives from the splash gate with `reverify`: the month since this number
  // was confirmed has passed, so the PIN is not enough and a code is required. Say why —
  // being asked for a number out of nowhere reads like the app forgot them.
  const reverify = (location.state as { reverify?: boolean } | null)?.reverify === true;
  const [phone, setPhone] = useState(invitedPhone);
  //
  // Who is signing in. One screen, two different questions.
  //
  // An owner is found by their number alone: they are the only account a phone number can start.
  // An employee is one of thousands, so their number is ambiguous — the shop has to be named
  // too, and it is the pair that gets checked before a code is spent. Asking which one you are
  // up front means the employee sees the field that governs their sign-in and the owner is not
  // handed a box they have no value for. Arriving through an invitation link means employee, so
  // the tab (and the number) are already right.
  const [role, setRole] = useState<"owner" | "employee">(inviteShopId ? "employee" : "owner");
  //
  // The shop, as a field rather than only a link detail — on the employee tab.
  //
  // An invitation is a claim about a PAIR — this number, that shop — so the person signing in
  // has to be able to state which shop invited them. It arrives filled in from the link
  // (`?shop=…`), and it can be typed as the short code the owner read out (0169) or as the raw
  // shop id from an older link. Accepting both is deliberate: the code is what a person is given
  // today, and the id is what is already sitting in messages people have on their phones.
  const [shopId, setShopId] = useState(inviteShopId);

  /**
   * An invitation is not the generic sign-in form with two boxes filled in.
   *
   * The link already answered the two questions that screen asks — which door (employee) and
   * which shop — so showing the tabs and both fields asked the person to re-read answers they
   * had not given, and every field left editable is a way to break the (shop, number) pair the
   * server is about to check. Arriving from a complete invitation (both params) therefore opens
   * a single screen: the shop, the number and one Continue. `Use a different number` reveals the
   * full form, still prefilled, for the person who forwarded the link or typed the wrong number.
   *
   * The pair is checked here as well as on submit. This check only decides what the screen says;
   * `handleSignIn` remains the one that spends the code, and it re-resolves the pair first.
   */
  const [inviteEntryOnly, setInviteEntryOnly] = useState(Boolean(invitedPhone && inviteShopId));
  const [inviteCheck, setInviteCheck] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  useEffect(() => {
    if (!inviteEntryOnly) return;
    const claimed = shopId.trim();
    const number = phone.replace(/\s/g, "");
    let alive = true;
    if (!claimed || !number) { setInviteCheck("invalid"); return; }
    setInviteCheck("checking");
    void (async () => {
      // The link carries the shop's short code when it could be read, and a raw id on older
      // links; resolveInvite takes the id, so the code is turned into one first. The name comes
      // back from the database for the pair, never from the link.
      let shopUuid = UUID_RE.test(claimed) ? claimed : "";
      if (!shopUuid) {
        const code = await resolveShopCode(claimed);
        if (!alive) return;
        if (!code.found || !code.shopId) { setInviteCheck("invalid"); return; }
        shopUuid = code.shopId;
        if (code.shopName) setInviteShopName(code.shopName);
      }
      const invite = await resolveInvite(shopUuid, number);
      if (!alive) return;
      if (!invite.found || !invite.invited) { setInviteCheck("invalid"); return; }
      if (invite.shopName) setInviteShopName(invite.shopName);
      setInviteCheck("valid");
    })().catch(() => { if (alive) setInviteCheck("invalid"); });
    return () => { alive = false; };
    // Once, on arrival: this is what the link said about the pair, not a live check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteEntryOnly]);

  // The number being confirmed is the one this device last served, so it is filled in rather
  // than asked for again: the person is standing on the same phone they always use.
  useEffect(() => {
    if (!reverify || invitedPhone) return;
    let alive = true;
    void lastUsedProfile().then((last) => {
      if (!alive || !last) return;
      // Stored in international digits; shown the way it is typed here (0300…).
      const stored = last.user.phone;
      setPhone(/^92\d{10}$/.test(stored) ? "0" + stored.slice(2) : stored);
    });
    return () => { alive = false; };
  }, [reverify, invitedPhone]);
  // Filled from the database, not the link: the name is read back from the shop the pair was
  // actually checked against, so a link cannot make the app say any shop it likes.
  const [inviteShopName, setInviteShopName] = useState("");
  //
  // The shop a typed CODE names — a different claim from "you were invited to it".
  //
  // A code says which shop it is; it says nothing about whether this number is on that shop's
  // list, and the person typing it needs the first fact before they submit. Keeping the two in
  // separate state is what stops the invitation line being shown to a number nobody invited —
  // which is exactly what a single shared state did, and it read as a lie when the field below
  // then refused the same number.
  const [codeShopName, setCodeShopName] = useState("");
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // A pasted shop id (uuid) is accepted as-is, so an invitation link from before codes existed
  // still lands somewhere. Anything else is treated as a code and resolved.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function validatePhone(p: string) {
    const clean = p.replace(/\s/g, "");
    // Accept local format (03001234567) or international (923001234567)
    return /^0\d{9,10}$/.test(clean) || /^92\d{10,11}$/.test(clean);
  }

  async function handleSignIn() {
    setPhoneError("");
    const cleanPhone = phone.replace(/\s/g, "");

    if (!validatePhone(cleanPhone)) {
      setPhoneError(t("auth.errPhoneFormat"));
      return;
    }

    setLoading(true);
    try {
      if (role === "employee") {
        // The shop code is a CLAIM, not the identity. A returning employee may not have it —
        // after a reinstall it is the first thing the device forgets — but the number is theirs
        // and the code sent to it proves that. Leaving the field blank therefore proceeds to the
        // code: once the number is proved, the server resolves the account, its active membership
        // and its branch scope. No second account is created, because the lookup is by the same
        // phone. A code that IS given is still checked as a (shop, number) pair before a code is
        // spent, so a wrong code is refused here rather than at the end.
        const typed = shopId.trim();
        let claimedShop = "";
        if (typed) {
          claimedShop = UUID_RE.test(typed) ? typed : "";
          if (!claimedShop) {
            const code = await resolveShopCode(typed);
            // An unknown code is a typo, and saying so is kinder than letting the person through
            // to a sign-in that will not find their invitation.
            if (!code.found || !code.shopId) {
              setPhoneError(t("auth.unknownShop"));
              return;
            }
            claimedShop = code.shopId;
            if (code.shopName) setCodeShopName(code.shopName);
          }
          const invite = await resolveInvite(claimedShop, cleanPhone);
          if (!invite.found) {
            setPhoneError(t("auth.unknownShop"));
            return;
          }
          if (!invite.invited) {
            setPhoneError(t("auth.errNotInvited", { shop: invite.shopName ?? "" }));
            return;
          }
          if (invite.shopName) setInviteShopName(invite.shopName);
        }
        // Clear any shop remembered from an earlier attempt: a blank field means "find me by
        // number", and a stale pair must not be re-checked at the code screen.
        rememberInviteShop(claimedShop || null);
      } else {
        // The owner path: this number is the whole claim.
        rememberInviteShop(null);
      }

      // Which stage does this number belong at? The check runs BEFORE a code is sent,
      // so an unregistered number is never sent one (and a registration applicant is
      // never mistaken for a stranger).
      const check = await checkPhoneRegistration(cleanPhone);
      if (check.status === "error") {
        // Could not ask the server — say so instead of acting as if the number were unknown.
        setPhoneError(t("auth.checkFailed"));
        return;
      }
      if (check.status !== "registered") {
        setPendingPhone(cleanPhone);
        if (check.status === "unregistered") { navigate("/login/not-registered"); return; }
        if (check.status === "pending") { navigate("/login/under-review"); return; }
        if (check.status === "rejected") { navigate("/login/rejected"); return; }
        navigate("/login/deactivated");
        return;
      }

      //
      // ONE PHONE, ONE DOOR.
      //
      // The tab asks which question you are answering; the account is what decides where you
      // land (`role === "admin"` opens the owner's app, anything else the employee's). Those two
      // disagreed: an owner could type their own number on the Employee tab, name their own shop,
      // pass the invitation check — they ARE a member of it — and be let through into the owner's
      // app, having answered the employee's questions. The reverse is just as wrong: an employee
      // typing their number on the Owner tab was sent a code and signed in, never having named
      // the shop whose branch they work in.
      //
      // The server's own answer settles it, here and before a code is spent. Being told which
      // door your number belongs at is not a scolding — the two tabs exist because the two kinds
      // of account sign in differently, so pointing at the right one is the fastest way in.
      const accountSide = check.role === "admin" ? "owner" : "employee";
      if (accountSide !== role) {
        setPhoneError(role === "employee" ? t("auth.wrongDoorOwner") : t("auth.wrongDoorEmployee"));
        return;
      }

      setPendingPhone(cleanPhone);
      setPendingFlow("login");
      setIsNewDevice(true);
      const result = await sendOTP(cleanPhone);
      if (!result.success) {
        setPhoneError(result.error || t("auth.errSendCode"));
        return;
      }
      navigate("/login/otp");
    } finally {
      setLoading(false);
    }
  }

  // The invitation entry: one decision, no fields. See the state block above for why the pair
  // is re-checked rather than trusted from the link.
  if (inviteEntryOnly) {
    const shownPhone = internationalPhone(phone || invitedPhone);
    return (
      <AuthLayout>
        <div className="flex flex-col flex-1 justify-between" data-testid="invite-join">
          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-2">
              <p className="text-26 font-bold" style={{ color: "var(--text-primary)" }} data-testid="invite-join-title">
                {t("auth.inviteJoinTitle")}
              </p>
              <p className="text-14" style={{ color: "var(--text-secondary)" }} data-testid="invite-join-body">
                {inviteShopName
                  ? t("auth.inviteJoinBody", { shop: inviteShopName, phone: shownPhone })
                  : t("auth.inviteJoinBodyNoShop", { phone: shownPhone })}
              </p>
            </div>

            <div
              className="rounded-[var(--radius-card)] px-4 py-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
            >
              <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{t("auth.phoneNumber")}</p>
              <p className="text-15 font-semibold mt-1" style={{ color: "var(--text-primary)" }} data-testid="invite-join-phone">
                {shownPhone}
              </p>
            </div>

            {inviteCheck === "checking" && (
              <p className="text-12" style={{ color: "var(--text-secondary)" }} data-testid="invite-join-checking">
                {t("auth.inviteJoinChecking")}
              </p>
            )}
            {inviteCheck === "invalid" && (
              <p className="text-12" style={{ color: "var(--error)" }} data-testid="invite-join-error">
                {t("auth.inviteJoinInvalid")}
              </p>
            )}
            {phoneError && (
              <p className="text-12" style={{ color: "var(--error)" }} data-testid="invite-join-error">
                {phoneError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 p-6">
            {inviteCheck === "valid" && (
              <Button
                fullWidth
                size="lg"
                onClick={handleSignIn}
                loading={loading}
                testId="invite-join-continue"
              >
                {t("auth.inviteJoinContinue")}
              </Button>
            )}
            <button
              type="button"
              onClick={() => { setInviteEntryOnly(false); setInviteCheck("idle"); }}
              className="text-13 text-center underline"
              style={{ color: "var(--text-secondary)" }}
              data-testid="invite-join-change"
            >
              {t("auth.inviteJoinChange")}
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col flex-1 justify-between">
        <div className="flex flex-col gap-8 p-6">
          <div className="flex flex-col gap-2">
            <p className="text-26 font-bold" style={{ color: "var(--text-primary)" }}>{t("auth.welcomeBack")}</p>
            <p className="text-14" style={{ color: "var(--text-secondary)" }}>
              {role === "employee" ? t("auth.enterPhoneEmployee") : t("auth.enterPhoneOwner")}
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {/* One screen, two questions: the answer changes what the form below asks for,
                while nothing else about signing in does.

                Two words with a rule under them, sized to the words. Not a filled segmented
                control (a second boxed container inside a form that already has boxed fields —
                the strip and the phone field read as the same kind of thing), and not two
                half-screen tabs either: a tab stretched to half the width puts its underline
                somewhere other than under its label, so the mark stops pointing at the choice.
                The underline spans exactly the word it belongs to.

                `start`/`end` rather than left/right, so the pair mirrors in Urdu.

                One size and one weight for both, with colour and the rule carrying the state.
                A heavier active label is wider than a lighter one, so choosing a tab moved the
                other tab sideways — a small shake on the whole row every time somebody
                corrected which of the two they are, on a screen where nothing else is
                supposed to move at all. Font size and weight are now fixed; only the tone
                changes. */}
            <div
              role="tablist"
              aria-label={t("auth.tabListLabel")}
              className="flex gap-7"
              data-testid="auth-role-tabs"
            >
              {(["owner", "employee"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={role === r}
                  onClick={() => { setRole(r); setPhoneError(""); }}
                  className="ds-pressable relative pt-1 pb-2.5 text-14"
                  style={{
                    background: "transparent",
                    color: role === r ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                  data-testid={r === "owner" ? "auth-tab-owner" : "auth-tab-employee"}
                >
                  {r === "owner" ? t("auth.tabOwner") : t("auth.tabEmployee")}
                  {role === r && (
                    <span
                      aria-hidden="true"
                      className="absolute start-0 end-0 rounded-full"
                      style={{ bottom: 0, height: 2, background: "var(--brand)" }}
                    />
                  )}
                </button>
              ))}
            </div>
            {codeShopName && !inviteShopName && (
              <div
                className="rounded-[var(--radius-tile)] px-3 py-2"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
                data-testid="code-shop-hint"
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                  {t("auth.codeShopNamed", { code: shopId.trim(), shop: codeShopName })}
                </p>
              </div>
            )}
            {inviteShopName && (
              <div
                className="rounded-[var(--radius-tile)] px-3 py-2"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
                data-testid="invited-hint"
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                  {t("auth.invitedToShop", { shop: inviteShopName })}
                </p>
              </div>
            )}
            {reverify && (
              <div
                className="rounded-[var(--radius-tile)] px-3 py-2"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
                data-testid="reverify-hint"
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                  {t("auth.reverifyReason")}
                </p>
              </div>
            )}
            <Input
              label={t("auth.phoneNumber")}
              type="tel"
              placeholder={t("common.phonePlaceholder")}
              value={phone}
              /* Digits only: a phone field takes a number, so a letter does nothing rather than
                 filling the field with something the check will reject. */
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              error={phoneError}
              /* The sentence belongs to the number, so it sits with the number.

                 It used to be a paragraph after the shop-code field, which made it read as
                 something about the code — the one field on this screen it does not describe.
                 Handing it to `Input`'s own hint keeps it under the field it explains, and gets
                 the error rule for free: a phone error replaces the hint instead of stacking
                 two lines under the same box. */
              hint={isDemoOtpMode ? t("auth.codeHintDemo") : t("auth.codeHint")}
              autoComplete="tel"
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
            />
            {    /* The shop the number belongs to — on the employee tab only, and BELOW the number.

                The number comes first because it is the one thing both roles are asked for: the
                field a person is already typing into does not move when they correct which tab
                they are, which is the jump that made this form feel like it reloaded. It is
                also the order they were told: your number, then the shop code.

                It is OPTIONAL because it is a claim, not the identity. An invitation link still
                fills it in and a code that is typed is still checked before a code is spent.
                Leaving it blank is how a returning employee gets back in after reinstalling:
                the code proves the number, and the database resolves the membership. */}
            {role === "employee" && (
              <>
                <Input
                  label={t("auth.shopCode")}
                  placeholder={t("auth.shopCodePlaceholder")}
                  value={shopId}
                  /* Correcting the code must clear what the old one named, or the line keeps
                     vouching for a shop that is no longer in the field. */
                  onChange={(e) => { setShopId(e.target.value.trim()); setCodeShopName(""); setPhoneError(""); }}
                  hint={t("auth.shopCodeOptionalHint")}
                  data-testid="shop-id-input"
                />
                {/* The code is optional: a returning employee can leave it blank and be
                    found by the number they prove. This link is for somebody who is not
                    in the shop at all yet — the page sends a request to the owner, and
                    never grants access by itself. */}
                <button
                  type="button"
                  onClick={() => navigate(`/login/request-access?phone=${encodeURIComponent(phone)}`)}
                  className="text-12 font-semibold text-start underline underline-offset-2 self-start ds-pressable"
                  style={{ color: "var(--text-secondary)" }}
                  data-testid="dont-know-shop-code"
                >
                  {t("auth.askToJoin")}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <Button
            fullWidth
            size="lg"
            onClick={handleSignIn}
            loading={loading}
            disabled={!phone}
          >
            {t("auth.sendCode")}
          </Button>
          {/* Only where it belongs: a shop owner is the one who registers a shop, and offering
              it to the employee on duty is how the wrong person ends up on this branch. */}
          {role === "owner" && (
            <p className="text-xs text-center text-caption" data-testid="auth-caption">
              {t("auth.newShopOwner")}{' '}
              <button onClick={() => navigate("/register")} className="text-foreground font-medium underline">
                {t("auth.registerShop")}
              </button>
            </p>
          )}

        </div>
      </div>
    </AuthLayout>
  );
}
