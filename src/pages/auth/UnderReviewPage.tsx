import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";

export default function UnderReviewPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <NavHeader title="" backTo="/login" />
      <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-[#fef3c7] flex items-center justify-center text-2xl">
          ⏳
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold text-black">Under Review</p>
          <p className="text-sm text-[#888]">
            Your shop registration has been submitted and is being reviewed by the admin.
          </p>
          <p className="text-sm text-[#888]">
            You'll be able to sign in once your account is approved.
          </p>
        </div>
        <Button fullWidth size="lg" onClick={() => navigate("/login")}>
          Back to Login
        </Button>
      </div>
    </AuthLayout>
  );
}
