import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";

export default function NotRegisteredPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#f5f5f5] flex items-center justify-center text-2xl">
          🔒
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">Number not registered</p>
          <p className="text-sm text-[#888]">
            This number isn't registered with any shop.
          </p>
          <p className="text-sm text-[#888]">
            If you're an employee, contact your shop admin to get access.
          </p>
        </div>
        <Button fullWidth size="lg" onClick={() => navigate("/login")}>
          Go Back
        </Button>
      </div>
    </AuthLayout>
  );
}
