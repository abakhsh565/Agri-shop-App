import { type ReactNode } from "react";
import StatusBar from "@/components/ui/StatusBar";

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex flex-col bg-white min-h-full w-full">
      <StatusBar />
      <div className="flex flex-col flex-1 w-full">
        {children}
      </div>
    </div>
  );
}
