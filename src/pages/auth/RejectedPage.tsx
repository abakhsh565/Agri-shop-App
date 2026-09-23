import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { XCircle } from "lucide-react";

export default function RejectedPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#fef2f2] flex items-center justify-center">
          <XCircle size={26} style={{ color: "var(--error)" }} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-foreground">{t("auth.rejected")}</p>
          <p className="text-sm text-caption">
            {t("auth.rejectedBody")}
          </p>
        </div>
        <Button fullWidth size="lg" onClick={() => navigate("/login")}>
          {t("auth.backToLogin")}
        </Button>
      </div>
    </AuthLayout>
  );
}
