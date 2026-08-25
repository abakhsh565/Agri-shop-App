import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import { supabase } from "@/lib/supabase";

export default function SetupDemoPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  async function setupDemoUsers() {
    setLoading(true);
    setResult("Setting up...");

    try {
      // First ensure default shop exists
      const { error: shopError } = await supabase
        .from("shops")
        .upsert({ id: "00000000-0000-0000-0000-000000000001", name: "Default Shop" }, { onConflict: "id" });

      if (shopError) {
        setResult(`Shop error: ${shopError.message}`);
        setLoading(false);
        return;
      }

      // Insert admin user
      const { error: adminError } = await supabase
        .from("users")
        .upsert({
          id: "11111111-1111-1111-1111-111111111111",
          name: "Shop Owner",
          phone: "923001234567",
          role: "admin",
          is_original_owner: true,
          is_active: true,
          employee_number: "EMP-001",
          shop_id: "00000000-0000-0000-0000-000000000001",
        }, { onConflict: "id" });

      if (adminError) {
        setResult(`Admin error: ${adminError.message}`);
        setLoading(false);
        return;
      }

      // Insert employee user
      const { error: empError } = await supabase
        .from("users")
        .upsert({
          id: "22222222-2222-2222-2222-222222222222",
          name: "Sales Employee",
          phone: "923001122334",
          role: "employee",
          is_original_owner: false,
          is_active: true,
          employee_number: "EMP-002",
          shop_id: "00000000-0000-0000-0000-000000000001",
        }, { onConflict: "id" });

      if (empError) {
        setResult(`Employee error: ${empError.message}`);
        setLoading(false);
        return;
      }

      // Verify
      const { data: users, error: checkError } = await supabase
        .from("users")
        .select("name, phone, role, is_active");

      if (checkError) {
        setResult(`Verify error: ${checkError.message}`);
      } else {
        setResult(`✅ Setup complete! ${users?.length ?? 0} users found:\n${JSON.stringify(users, null, 2)}`);
      }
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col flex-1 items-center justify-center p-6 gap-6">
        <div className="text-center">
          <p className="text-[28px] font-bold text-black">Setup Demo Users</p>
          <p className="text-sm text-[#888] mt-2">
            Click the button below to create demo users for testing
          </p>
        </div>

        <button
          onClick={setupDemoUsers}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm"
          style={{ background: "#000", color: "#fff" }}
        >
          {loading ? "Setting up..." : "Create Demo Users"}
        </button>

        {result && (
          <div className="w-full p-4 rounded-[14px] bg-gray-100">
            <pre className="text-xs whitespace-pre-wrap">{result}</pre>
          </div>
        )}

        <button
          onClick={() => navigate("/login")}
          className="text-sm text-[#888] underline"
        >
          Back to Login
        </button>
      </div>
    </AuthLayout>
  );
}
