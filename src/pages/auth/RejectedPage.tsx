import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";

export default function RejectedPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#fef2f2] flex items-center justify-center text-2xl">
          ❌
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">Registration Rejected</p>
          <p className="text-sm text-[#888]">
            Your shop registration was not approved. Please contact support for more information.
          </p>
        </div>
        <Button fullWidth size="lg" onClick={() => navigate("/login")}>
          Back to Login
        </Button>
      </div>
    </AuthLayout>
  );
}
