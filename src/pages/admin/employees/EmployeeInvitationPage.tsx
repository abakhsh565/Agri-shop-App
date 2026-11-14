import { useState } from "react";
import { useParams } from "react-router-dom";
import { Mail, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import InviteLinkCard from "@/components/admin/InviteLinkCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { provisionMemberLogin } from "@/lib/auth";

/** The invitation itself, kept off the profile so the profile can stay a profile. */
export default function EmployeeInvitationPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const base = useShellBase();
  const { language } = useThemeStore();
  const t = useT();
  const { addToast } = useUIStore();
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const [loginFixing, setLoginFixing] = useState(false);
  const [loginFixed, setLoginFixed] = useState(false);

  const emp = employees.find((employee) => employee.id === employeeId);
  const rtl = language === "ur";

  if (!emp) {
    return (
      <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
        <StatusBar />
        <NavHeader title={t("empInvite.title")} backTo={`${base}/employees`} />
        {employeesReady ? (
          <p className="text-13 text-center py-16" style={{ color: "var(--text-secondary)" }}>{t("empDetail.notFound")}</p>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  const isInvited = emp.membershipStatus === "pending" && emp.isActive;

  async function handleFixSignIn() {
    if (loginFixing || loginFixed || !emp) return;
    setLoginFixing(true);
    try {
      const res = await provisionMemberLogin(emp.id);
      if (!res.ok) throw new Error(res.error ?? "");
      setLoginFixed(true);
      addToast(t("empDetail.fixSignInDone", { name: emp.name }), "success");
    } catch (error) {
      addToast(error instanceof Error && error.message ? error.message : t("empDetail.fixSignInFailed"), "error");
    } finally {
      setLoginFixing(false);
    }
  }

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-invitation-page"
    >
      <StatusBar />
      <NavHeader title={t("empInvite.title")} backTo={`${base}/employees/${emp.id}`} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4 flex items-start gap-3"
          style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
        >
          <span
            className="size-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
          >
            <Mail size={17} />
          </span>
          <div>
            <p className="text-13 font-bold">
              {isInvited ? t("empDetail.invitedTitle") : t("empInvite.acceptedTitle")}
            </p>
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)", lineHeight: 1.55 }}>
              {isInvited
                ? t("empInvite.intro", { name: emp.name })
                : t("empInvite.acceptedHint", { name: emp.name })}
            </p>
          </div>
        </div>
      </div>

      {isInvited && (
        <>
          <div className="px-4 pt-4">
            <InviteLinkCard name={emp.name} phone={emp.phone} />
          </div>

          <div className="px-4 pt-4">
            <div
              className="rounded-[var(--radius-card)] p-4 flex items-start justify-between gap-3"
              style={{ background: "var(--tone-card)" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} style={{ color: "var(--text-secondary)" }} />
                  <p className="text-12 font-bold">{t("empDetail.fixSignIn")}</p>
                </div>
                <p className="text-10 mt-1" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {loginFixed
                    ? t("empDetail.fixSignInDone", { name: emp.name })
                    : t("empDetail.fixSignInHint", { name: emp.name })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleFixSignIn()}
                disabled={loginFixing || loginFixed}
                data-testid="emp-fix-signin"
                className="shrink-0 h-9 px-3.5 rounded-full text-11 font-bold disabled:opacity-50"
                style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
              >
                {t("empDetail.fixSignInAction")}
              </button>
            </div>
          </div>
        </>
      )}

      <p className="px-5 pt-5 text-10" style={{ color: "var(--text-tertiary)", lineHeight: 1.55 }}>
        {t("empInvite.note")}
      </p>
    </div>
  );
}
