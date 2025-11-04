import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type {
  PreferencesSettingsResponse,
  PreferencesUpdateRequest,
} from "@/types/company";
import { DEFAULT_COMPANY } from "@shared/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

const PreferencesTab = ({}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const [companySettingsLocal, setCompanySettingsLocal] =
    useState<PreferencesSettingsResponse>({
      timezone: DEFAULT_COMPANY.PREFERENCES.TIMEZONE,
      dateFormat: DEFAULT_COMPANY.PREFERENCES.DATE_FORMAT,
      timeFormat: DEFAULT_COMPANY.PREFERENCES.TIME_FORMAT as any,
      maxFileUploadSize: DEFAULT_COMPANY.BRANDING.MAX_UPLOAD_MB,
      maintenanceMode: false,
    });

  const { data: preferencesData } = useQuery({
    queryKey: ["/api/company-settings/preferences"],
    retry: false,
  });

  useEffect(() => {
    if (preferencesData) {
      const d = preferencesData as PreferencesSettingsResponse;
      setCompanySettingsLocal({
        timezone: d.timezone || DEFAULT_COMPANY.PREFERENCES.TIMEZONE,
        dateFormat: d.dateFormat || DEFAULT_COMPANY.PREFERENCES.DATE_FORMAT,
        timeFormat: (d.timeFormat ||
          DEFAULT_COMPANY.PREFERENCES.TIME_FORMAT) as any,
        maxFileUploadSize:
          d.maxFileUploadSize ?? DEFAULT_COMPANY.BRANDING.MAX_UPLOAD_MB,
        maintenanceMode: !!d.maintenanceMode,
      });
    }
  }, [preferencesData]);

  const updateCompanySettingsMutation = useMutation({
    mutationFn: async (data: PreferencesUpdateRequest) =>
      apiRequest("PATCH", "/api/company-settings/preferences", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/company-settings/preferences"],
      });
      toast({
        title: "Success",
        description: "Company settings updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update company settings",
        variant: "destructive",
      });
    },
  });

  const handleSavePreferences = async () => {
    const errors: Record<string, string> = {};
    const timezone = String(companySettingsLocal.timezone || "").trim();
    if (!timezone) errors.timezone = "Timezone is required";
    const dateFormat = String(companySettingsLocal.dateFormat || "").trim();
    if (!dateFormat) errors.dateFormat = "Date format is required";
    const timeFormat = String(companySettingsLocal.timeFormat || "").trim();
    if (!timeFormat) errors.timeFormat = "Time format is required";
    const maxSize = Number(companySettingsLocal.maxFileUploadSize || 0);
    if (!maxSize || maxSize < 1 || maxSize > 100)
      errors.maxFileUploadSize = "Upload size must be 1-100 MB";
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;
    updateCompanySettingsMutation.mutate({
      timezone,
      dateFormat,
      timeFormat: timeFormat as any,
      maxFileUploadSize: maxSize,
      maintenanceMode: !!companySettingsLocal.maintenanceMode,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Customize your company preferences to match your business needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-2">
          <Label>Timezone</Label>
          <Select
            value={companySettingsLocal.timezone || "UTC"}
            onValueChange={(v: string) =>
              setCompanySettingsLocal((p: typeof companySettingsLocal) => ({
                ...p,
                timezone: v,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UTC">
                UTC (Coordinated Universal Time)
              </SelectItem>
              <SelectItem value="America/New_York">
                America/New_York (EST/EDT)
              </SelectItem>
              <SelectItem value="America/Chicago">
                America/Chicago (CST/CDT)
              </SelectItem>
              <SelectItem value="America/Denver">
                America/Denver (MST/MDT)
              </SelectItem>
              <SelectItem value="America/Los_Angeles">
                America/Los_Angeles (PST/PDT)
              </SelectItem>
              <SelectItem value="Europe/London">
                Europe/London (GMT/BST)
              </SelectItem>
              <SelectItem value="Europe/Paris">
                Europe/Paris (CET/CEST)
              </SelectItem>
              <SelectItem value="Asia/Tokyo">Asia/Tokyo (JST)</SelectItem>
              <SelectItem value="Asia/Shanghai">Asia/Shanghai (CST)</SelectItem>
              <SelectItem value="Australia/Sydney">
                Australia/Sydney (AEST/AEDT)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            System timezone for date and time display
          </p>
          {validationErrors?.timezone && (
            <p className="text-sm text-destructive">
              {validationErrors.timezone}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Date Format</Label>
          <Select
            value={companySettingsLocal.dateFormat || "YYYY-MM-DD"}
            onValueChange={(v: string) =>
              setCompanySettingsLocal((p: typeof companySettingsLocal) => ({
                ...p,
                dateFormat: v,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select date format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">
                YYYY-MM-DD (2024-01-15)
              </SelectItem>
              <SelectItem value="MM/DD/YYYY">
                MM/DD/YYYY (01/15/2024)
              </SelectItem>
              <SelectItem value="DD/MM/YYYY">
                DD/MM/YYYY (15/01/2024)
              </SelectItem>
              <SelectItem value="DD-MM-YYYY">
                DD-MM-YYYY (15-01-2024)
              </SelectItem>
              <SelectItem value="MMM DD, YYYY">
                MMM DD, YYYY (Jan 15, 2024)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Format for displaying dates throughout the application
          </p>
          {validationErrors?.dateFormat && (
            <p className="text-sm text-destructive">
              {validationErrors.dateFormat}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Time Format</Label>
          <Select
            value={companySettingsLocal.timeFormat || "24h"}
            onValueChange={(v: string) =>
              setCompanySettingsLocal((p: typeof companySettingsLocal) => ({
                ...p,
                timeFormat: v as any,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select time format" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="24h">24-hour (14:30)</SelectItem>
              <SelectItem value="12h">12-hour (2:30 PM)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Format for displaying times throughout the application
          </p>
          {validationErrors?.timeFormat && (
            <p className="text-sm text-destructive">
              {validationErrors.timeFormat}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Max File Upload Size (MB)</Label>
          <Input
            data-field="maxFileUploadSize"
            type="number"
            min="1"
            max="100"
            value={companySettingsLocal.maxFileUploadSize || 10}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v))
                setCompanySettingsLocal((p: typeof companySettingsLocal) => ({
                  ...p,
                  maxFileUploadSize: v,
                }));
            }}
            placeholder="10"
            className={
              validationErrors?.maxFileUploadSize ? "border-destructive" : ""
            }
          />
          <p className="text-sm text-muted-foreground">
            Maximum file upload size in megabytes (1-100 MB)
          </p>
          {validationErrors?.maxFileUploadSize && (
            <p className="text-sm text-destructive">
              {validationErrors.maxFileUploadSize}
            </p>
          )}
        </div>

        <div className="space-y-2 col-span-1 md:col-span-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Maintenance Mode</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, the system will be in maintenance mode and users
                will see a maintenance message
              </p>
            </div>
            <Switch
              checked={companySettingsLocal.maintenanceMode || false}
              onCheckedChange={(v: boolean) =>
                setCompanySettingsLocal((p: typeof companySettingsLocal) => ({
                  ...p,
                  maintenanceMode: v,
                }))
              }
            />
          </div>
          {companySettingsLocal.maintenanceMode && (
            <Alert className="mt-2">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Maintenance Mode Active</AlertTitle>
              <AlertDescription>
                Users will see a maintenance message when this mode is enabled.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex justify-end">
        <Button
          onClick={handleSavePreferences}
          disabled={updateCompanySettingsMutation.isPending}
        >
          {updateCompanySettingsMutation.isPending
            ? "Saving..."
            : "Save Preferences"}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default PreferencesTab;
