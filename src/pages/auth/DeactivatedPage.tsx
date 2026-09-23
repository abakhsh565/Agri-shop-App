import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import { useT } from "@/lib/i18n";
import { Ban } from "lucide-react";

export default function DeactivatedPage() {
  const t = useT();
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#f5f5f5] flex items-center justify-center">
          <Ban size={26} style={{ color: "var(--text-secondary)" }} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">{t("auth.accessRevoked")}</p>
          <p className="text-sm text-[#888]">
            {t("auth.accessRevokedBody")}
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
