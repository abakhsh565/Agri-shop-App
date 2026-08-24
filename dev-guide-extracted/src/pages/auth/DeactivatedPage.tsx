import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";

export default function DeactivatedPage() {
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#f5f5f5] flex items-center justify-center text-2xl">
          ⛔
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">Access revoked</p>
          <p className="text-sm text-[#888]">
            Your access has been revoked. Contact your shop admin to restore access.
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
