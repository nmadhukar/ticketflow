import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Palette, TicketIcon, Settings, Mail } from "lucide-react";
import BrandingTab from "./BrandingTab";
import EmailTab from "./EmailTab";
import PreferencesTab from "./PreferencesTab";
import TicketsTab from "./TicketsTab";
import { DEFAULT_COMPANY } from "@shared/constants";

type CompanyConsoleProps = {
  defaultTab?: "branding" | "tickets" | "preferences" | "email";
};

const CompanyConsole = ({}: CompanyConsoleProps) => {
  const [companySettingsLocal, setCompanySettingsLocal] = useState<{
    companyName?: string;
    ticketPrefix?: string;
    defaultTicketPriority?: string;
    autoCloseDays?: number | null;
    timezone?: string;
    dateFormat?: string;
    timeFormat?: string;
    maxFileUploadSize?: number;
    maintenanceMode?: boolean;
    logoUrl?: string;
    primaryColor?: string;
  }>({});

  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
    retry: false,
  });

  useEffect(() => {
    if (companySettings) {
      setCompanySettingsLocal({
        companyName: (companySettings as any).companyName || "",
        ticketPrefix: (companySettings as any).ticketPrefix || "TKT",
        defaultTicketPriority:
          (companySettings as any).defaultTicketPriority || "medium",
        autoCloseDays:
          (companySettings as any).autoCloseDays === undefined
            ? 7
            : (companySettings as any).autoCloseDays,
        timezone: (companySettings as any).timezone || "UTC",
        dateFormat: (companySettings as any).dateFormat || "YYYY-MM-DD",
        timeFormat: (companySettings as any).timeFormat || "24h",
        maxFileUploadSize: (companySettings as any).maxFileUploadSize || 10,
        maintenanceMode: (companySettings as any).maintenanceMode || false,
        logoUrl: (companySettings as any).logoUrl || undefined,
        primaryColor:
          (companySettings as any).primaryColor ||
          DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR,
      });
    }
  }, [companySettings]);

  return (
    <Tabs defaultValue="branding" className="space-y-6">
      <TabsList>
        <TabsTrigger className="px- flex items-center gap-2" value="branding">
          <Palette className="h-4 w-4" />
          <span>Branding</span>
        </TabsTrigger>
        <TabsTrigger className="px- flex items-center gap-2" value="tickets">
          <TicketIcon className="h-4 w-4" />
          <span>Tickets</span>
        </TabsTrigger>
        <TabsTrigger
          className="px- flex items-center gap-2"
          value="preferences"
        >
          <Settings className="h-4 w-4" />
          <span>Preferences</span>
        </TabsTrigger>
        <TabsTrigger className="px- flex items-center gap-2" value="email">
          <Mail className="h-4 w-4" />
          <span>Email</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="branding">
        <BrandingTab />
      </TabsContent>
      <TabsContent value="tickets">
        <TicketsTab />
      </TabsContent>
      <TabsContent value="preferences">
        <PreferencesTab />
      </TabsContent>
      <TabsContent value="email">
        <EmailTab />
      </TabsContent>
    </Tabs>
  );
};

export default CompanyConsole;
