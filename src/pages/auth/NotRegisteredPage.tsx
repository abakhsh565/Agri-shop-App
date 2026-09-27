import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { Lock } from "lucide-react";

export default function NotRegisteredPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Lock size={26} style={{ color: "var(--text-secondary)" }} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-foreground">{t("auth.numberNotRegistered")}</p>
          <p className="text-sm text-caption">
            {t("auth.numberNotRegisteredBody")}
          </p>
          <p className="text-sm text-caption">
            {t("auth.numberNotRegisteredNext")}
          </p>
          <p className="text-sm text-caption">
            {t("auth.employeeContactAdmin")}
          </p>
        </div>
        {/* Signup is the way forward for a number nobody has registered; going back is
            only for someone who mistyped. */}
        <div className="flex flex-col gap-3 w-full">
          <Button fullWidth size="lg" onClick={() => navigate("/register")}>
            {t("auth.createAccount")}
          </Button>
          <Button fullWidth size="lg" variant="ghost" onClick={() => navigate("/login")}>
            {t("common.goBack")}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
