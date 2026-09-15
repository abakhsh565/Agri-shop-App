// Supabase Edge Function: process-reminders
// Runs daily via pg_cron to evaluate reminder configs and send notifications
// Deploy: supabase functions deploy process-reminders

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const today = now.toISOString().split("T")[0];
    let processedCount = 0;
    let sentCount = 0;

    // 1. Get all customers with outstanding balance and a due date
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id, name, phone, due_date, outstanding_balance")
      .gt("outstanding_balance", 0)
      .not("due_date", "is", null);

    if (custErr) throw new Error(`Customer fetch failed: ${custErr.message}`);
    if (!customers || customers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No eligible customers", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get all active reminder configs
    const { data: configs, error: cfgErr } = await supabase
      .from("reminder_configs")
      .select("*")
      .eq("enabled", true);

    if (cfgErr) throw new Error(`Config fetch failed: ${cfgErr.message}`);
    if (!configs || configs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active reminder configs", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Get business settings for crop configs
    const { data: bizSettings } = await supabase
      .from("business_settings")
      .select("setting_value")
      .eq("setting_key", "crops")
      .limit(1)
      .single();

    let crops: any[] = [];
    if (bizSettings?.setting_value) {
      try {
        crops = typeof bizSettings.setting_value === "string" ? JSON.parse(bizSettings.setting_value) : bizSettings.setting_value;
        if (!Array.isArray(crops)) crops = [];
      } catch { crops = []; }
    }

    // 4. Process each customer
    for (const customer of customers) {
      const customerConfigs = configs.filter(
        (c) => c.customer_id === customer.id
      );
      if (customerConfigs.length === 0) continue;

      // Get latest credit sale for this customer
      const { data: latestSale } = await supabase
        .from("sales")
        .select("created_at")
        .eq("customer_id", customer.id)
        .neq("payment_type", "full")
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Get customer crops for harvest-based reminders
      const { data: customerCrops } = await supabase
        .from("customer_crops")
        .select("crop_name")
        .eq("customer_id", customer.id);

      const cropNames = customerCrops?.map((c) => c.crop_name) || [];

      for (const config of customerConfigs) {
        const dueDate = customer.due_date
          ? new Date(customer.due_date)
          : null;
        const todayDate = new Date(today);

        // Calculate trigger date based on anchor type
        let triggerDate: Date | null = null;

        if (config.anchor === "before_due" && dueDate) {
          triggerDate = new Date(dueDate);
          triggerDate.setDate(
            triggerDate.getDate() - (config.start_days || 0)
          );
        } else if (config.anchor === "after_due" && dueDate) {
          triggerDate = new Date(dueDate);
          triggerDate.setDate(
            triggerDate.getDate() + (config.start_days || 0)
          );
        } else if (config.anchor === "after_credit" && latestSale) {
          triggerDate = new Date(latestSale.created_at);
          triggerDate.setDate(
            triggerDate.getDate() + (config.start_days || 0)
          );
        } else if (
          config.anchor === "before_harvest" &&
          cropNames.length > 0
        ) {
          // Handle harvest-based for each crop
          for (const cropName of cropNames) {
            const crop = crops.find(
              (c: { name: string }) => c.name === cropName
            );
            if (!crop) continue;

            const harvestDate = new Date(
              now.getFullYear(),
              (crop.harvestMonth || 1) - 1,
              crop.harvestDay || 1
            );
            if (harvestDate <= todayDate) {
              harvestDate.setFullYear(harvestDate.getFullYear() + 1);
            }
            triggerDate = new Date(harvestDate);
            triggerDate.setDate(
              triggerDate.getDate() - (config.start_days || 0)
            );
          }
        }

        if (!triggerDate || triggerDate > todayDate) continue;

        // Check stop conditions
        if (config.ends === "count") {
          const { count } = await supabase
            .from("reminder_logs")
            .select("id", { count: "exact", head: true })
            .eq("customer_id", customer.id)
            .eq("config_id", config.id);
          if ((count || 0) >= (config.ends_count || 5)) continue;
        } else if (config.ends === "date" && config.ends_date) {
          if (new Date(config.ends_date) < todayDate) continue;
        }

        // Determine tone based on escalation
        let tone = "gentle";
        if (config.repeat_type === "escalate" && config.escalation) {
          const daysElapsed = Math.floor(
            (todayDate.getTime() - triggerDate.getTime()) / 86400000
          );
          const sorted = [...config.escalation].sort(
            (a: { day: number }, b: { day: number }) => a.day - b.day
          );
          for (const step of sorted) {
            if (daysElapsed >= step.day) {
              tone = step.tone?.includes("final")
                ? "final"
                : step.tone?.includes("firmer")
                ? "firmer"
                : "gentle";
            }
          }
        }

        // Check if already sent today for this config
        const { data: existingLog } = await supabase
          .from("reminder_logs")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("config_id", config.id)
          .gte("sent_at", today)
          .limit(1)
          .single();

        if (existingLog) continue; // Already processed today

        // Create reminder log entry
        const firstName = customer.name.split(" ")[0];
        const amount = `Rs. ${Math.round(
          customer.outstanding_balance
        ).toLocaleString("en-PK")}`;

        let message = "";
        if (tone === "gentle") {
          message = `Hello ${firstName}, this is a friendly reminder that ${amount} is currently outstanding on your account. Please arrange payment when convenient.`;
        } else if (tone === "firmer") {
          message = `Hello ${firstName}, ${amount} remains outstanding on your account. Please arrange payment at your earliest convenience.`;
        } else {
          message = `Hello ${firstName}, ${amount} remains outstanding on your account. Please contact us regarding settlement. Do not ignore this message.`;
        }

        const { error: insertErr } = await supabase
          .from("reminder_logs")
          .insert({
            customer_id: customer.id,
            customer_name: customer.name,
            config_id: config.id,
            tone,
            message,
            channel: "auto_generated",
            sent_at: now.toISOString(),
          });

        if (insertErr) {
          console.error(`Insert failed for ${customer.name}:`, insertErr);
          continue;
        }

        sentCount++;
        processedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        message: "Reminders processed",
        processed: processedCount,
        created: sentCount,
        timestamp: now.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
