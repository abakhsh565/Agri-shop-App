import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Plus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import EmptyState from "@/components/ui/EmptyState";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import LogoTile from "@/components/ui/LogoTile";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Sheet from "@/components/ui/Sheet";
import Skeleton from "@/components/ui/Skeleton";
import QrCode from "@/components/ui/QrCode";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatTime } from "@/lib/formatters";
import { copyText } from "@/lib/clipboard";
import { useFarmerMessagesStore, type FarmerThreadRow } from "@/stores/farmerMessagesStore";

/**
 * Messages — one list of people, the way a phone's messenger works.
 *
 * WHY ONE LIST. The previous version split the screen in two: a queue of work and a list of
 * conversations, so the same farmer appeared twice and the owner had to learn which list to
 * read. Here there is one row per farmer, newest first, and a farmer whose ask is still open
 * rises to the top with one plain line under his last message. That line is the only new idea
 * on the screen, and it is written as a sentence, not a colour code, because the shop owner
 * must be able to act without decoding anything.
 *
 * THE PICTURE IS THE PERSON. Tapping the avatar opens his profile; tapping the row opens the
 * conversation, exactly as in WhatsApp. The header's plus is the one way to add a farmer, so the
 * screen has no second call to action.
 */
export default function AdminMessagesPage() {
  const t = useT();
  const base = useShellBase();
  const returnTo = useReturnTo(`${base}/more`);
  const navigate = useNavigate();

  const threads = useFarmerMessagesStore((s) => s.threads);
  const loading = useFarmerMessagesStore((s) => s.threadsLoading);
  const loadThreads = useFarmerMessagesStore((s) => s.loadThreads);
  const registerFarmer = useFarmerMessagesStore((s) => s.registerFarmer);
  const shopJoinCode = useFarmerMessagesStore((s) => s.shopJoinCode);

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [village, setVillage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shopOpen, setShopOpen] = useState(false);
  const [shopCode, setShopCode] = useState<{ code: string; shop_name: string } | null>(null);
  const [shopBusy, setShopBusy] = useState(false);
  const [shopError, setShopError] = useState("");
  const [shopCopied, setShopCopied] = useState(false);
  // The already-loaded code, readable on the same tick as the tap. A state value is still false
  // for a second tap in the same task, which is exactly when a second RPC would be sent.
  const shopCodeCache = useRef<{ code: string; shop_name: string } | null>(null);

  useEffect(() => {
    void loadThreads("").catch(() => undefined);
  }, [loadThreads]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadThreads(search).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(id);
  }, [search, loadThreads]);

  // The list is a live inbox too: a farmer who writes while the owner is looking at it should see
  // his row rise without a manual refresh. Twenty seconds is deliberately slower than the open
  // thread's twelve — a conversation is where an answer is expected, the list only announces it.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadThreads(search).catch(() => undefined);
    }, 20000);
    return () => window.clearInterval(id);
  }, [search, loadThreads]);

  /** Open work first, then the freshest conversation. One rule, no second sorting control. */
  const ordered = useMemo(() => {
    const waiting = (row: FarmerThreadRow) => row.open_requests + row.open_visits;
    return [...threads].sort((a, b) => {
      const aw = waiting(a) > 0 ? 1 : 0;
      const bw = waiting(b) > 0 ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? ""));
    });
  }, [threads]);

  async function save() {
    if (!name.trim() || !phone.trim()) {
      setError(t("messages.nameAndPhoneRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const id = await registerFarmer({ name, phone, village });
      setAdding(false);
      setName("");
      setPhone("");
      setVillage("");
      await loadThreads(search);
      navigate(`${base}/messages/${id}`);
    } catch {
      setError(t("messages.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  /**
   * The other way in: one code for the whole shop, printed and left at the counter.
   *
   * It is loaded once per visit and kept, because the code is stable — re-reading it on every
   * open would only add a round trip that answers the same six characters.
   */
  async function openShopCode() {
    setShopOpen(true);
    if (shopCodeCache.current) return;
    setShopBusy(true);
    setShopError("");
    try {
      const code = await shopJoinCode();
      shopCodeCache.current = code;
      setShopCode(code);
    } catch {
      setShopError(t("messages.issueFailed"));
    } finally {
      setShopBusy(false);
    }
  }

  async function copyShopCode() {
    if (!shopCode) return;
    if (await copyText(shopCode.code)) {
      setShopCopied(true);
      window.setTimeout(() => setShopCopied(false), 2000);
    }
  }

  const hasThreads = ordered.length > 0;

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader
        title={t("admin.messages")}
        backTo={returnTo}
        right={
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={t("messages.addFarmer")}
            className="flex size-11 items-center justify-center rounded-full"
            style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
            data-testid="messages-add-farmer"
          >
            <Plus size={20} strokeWidth={1.5} />
          </button>
        }
      />

      <div className="px-4 pb-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("messages.searchPlaceholder")}
        />
      </div>

      {loading && !hasThreads ? (
        <div className="px-4 flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : hasThreads ? (
        <div className="px-4 pb-8">
          <ListCard>
            {ordered.map((row) => {
              const waiting = row.open_requests + row.open_visits;
              return (
                <ListRow
                  key={row.farmer_id}
                  testId={`farmer-thread-${row.farmer_id}`}
                  tile={
                    <button
                      type="button"
                      onClick={() => navigate(`${base}/messages/${row.farmer_id}/profile`)}
                      aria-label={t("messages.openProfileAria", { name: row.name })}
                      className="shrink-0 rounded-full"
                      data-testid={`farmer-avatar-${row.farmer_id}`}
                    >
                      <LogoTile name={row.name} size={46} />
                    </button>
                  }
                  value={row.last_message_at ? listStamp(row.last_message_at) : undefined}
                  trailing={
                    row.unread_count > 0 ? (
                      <span
                        className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-10 font-semibold shrink-0"
                        style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
                      >
                        {row.unread_count}
                      </span>
                    ) : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => navigate(`${base}/messages/${row.farmer_id}`)}
                    className="w-full min-w-0 text-start flex flex-col gap-0.5"
                    data-testid={`farmer-open-chat-${row.farmer_id}`}
                  >
                    <span className="text-15 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {row.name}
                    </span>
                    <span className="text-12 truncate" style={{ color: "var(--text-secondary)" }}>
                      {row.last_message ?? row.village ?? row.phone}
                    </span>
                    {waiting > 0 && (
                      <span
                        className="inline-flex items-center gap-1.5 text-11 font-medium truncate"
                        style={{ color: "var(--brand-dark)" }}
                      >
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full shrink-0"
                          style={{ background: "var(--brand)" }}
                        />
                        {waiting === 1
                          ? t("messages.rowWaitingOne")
                          : t("messages.rowWaitingMany", { count: waiting })}
                      </span>
                    )}
                  </button>
                </ListRow>
              );
            })}
          </ListCard>
        </div>
      ) : search.trim() ? (
        <EmptyState
          icon={MessageSquare}
          title={t("messages.searchEmpty")}
          subtitle={t("messages.searchEmptyHint")}
        />
      ) : (
        <EmptyState
          icon={MessageSquare}
          title={t("messages.emptyTitle")}
          subtitle={t("messages.emptyHint")}
          action={{ label: t("messages.addFarmer"), onClick: () => setAdding(true) }}
        />
      )}

      <Sheet open={adding} title={t("messages.addFarmer")} onClose={() => setAdding(false)}>
        <div className="px-4 pb-6 flex flex-col gap-3">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("messages.addFarmerHint")}
          </p>
          <Input
            label={t("messages.farmerName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("messages.farmerName")}
          />
          <Input
            label={t("messages.farmerPhone")}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="03001234567"
          />
          <Input
            label={t("messages.village")}
            value={village}
            onChange={(e) => setVillage(e.target.value)}
            placeholder={t("messages.village")}
          />
          {error && (
            <p className="text-12" style={{ color: "var(--error)" }}>
              {error}
            </p>
          )}
          <Button fullWidth loading={saving} onClick={() => void save()} testId="messages-save-farmer">
            {t("common.save")}
          </Button>

          {/* The second door, kept below the first so adding a farmer stays the obvious path. */}
          <div className="pt-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--hairline)" }}>
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("messages.shopCodeOr")}
            </p>
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                setAdding(false);
                void openShopCode();
              }}
              testId="messages-show-shop-code"
            >
              {t("messages.showShopCode")}
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={shopOpen}
        title={t("messages.shopCodeTitle")}
        onClose={() => setShopOpen(false)}
      >
        <div className="px-4 pb-6 flex flex-col items-center gap-3 text-center">
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>
            {t("messages.shopCodeHint")}
          </p>
          {shopBusy ? (
            <Skeleton className="h-[200px] w-[200px]" />
          ) : shopError ? (
            <p className="text-13" style={{ color: "var(--error)" }}>
              {shopError}
            </p>
          ) : shopCode ? (
            <>
              <QrCode
                value={`agrishop://join?code=${shopCode.code}`}
                size={200}
                label={t("messages.shopCodeTitle")}
              />
              <p
                className="text-22 font-bold tabular-nums"
                style={{ letterSpacing: "0.18em", color: "var(--text-primary)" }}
                data-testid="messages-shop-code"
              >
                {shopCode.code}
              </p>
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("messages.shopCodePrint")}
              </p>
              <Button
                variant="outline"
                fullWidth
                onClick={() => void copyShopCode()}
                testId="messages-copy-shop-code"
              >
                {shopCopied ? t("messages.copied") : t("messages.copyCode")}
              </Button>
            </>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

/** A list timestamp the way a messenger shows it: the time today, the date before that. */
function listStamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(iso);
  return date.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}
