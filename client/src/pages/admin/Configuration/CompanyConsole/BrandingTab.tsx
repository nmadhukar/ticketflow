import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Palette, Upload } from "lucide-react";
import { Label } from "@/components/ui/label";
import type {
  BrandingSettingsResponse,
  BrandingUpdateRequest,
} from "@/types/company";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DEFAULT_COMPANY } from "@shared/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

const BrandingTab = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const [companySettingsLocal, setCompanySettingsLocal] =
    useState<BrandingSettingsResponse>({
      companyName: "",
      logoUrl: null,
      primaryColor: DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR,
    });

  // Initialize via GET /branding
  const { data: brandingData } = useQuery({
    queryKey: ["/api/company-settings/branding"],
    retry: false,
  });

  useEffect(() => {
    if (brandingData) {
      const d = brandingData as BrandingSettingsResponse;
      setCompanySettingsLocal({
        companyName: d.companyName || "",
        logoUrl: d.logoUrl ?? null,
        primaryColor: d.primaryColor || DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR,
      });
    }
  }, [brandingData]);

  const uploadLogoMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest(
        "POST",
        "/api/company-settings/branding/logo",
        data
      );
      return await response.json();
    },
    onSuccess: (data: any) => {
      if (data?.logoUrl) {
        setCompanySettingsLocal((prev) => ({ ...prev, logoUrl: data.logoUrl }));
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/company-settings/branding"],
      });
      toast({ title: "Success", description: "Logo uploaded successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to upload logo",
        variant: "destructive",
      });
    },
  });

  const updateCompanySettingsMutation = useMutation({
    mutationFn: async (data: BrandingUpdateRequest) =>
      apiRequest("PATCH", "/api/company-settings/branding", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/company-settings/branding"],
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

  const handleLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/(jpe?g|png)$/i.test(file.type)) {
      toast({
        title: "Invalid file",
        description: "Please select a JPG or PNG image",
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const maxSizeMB = DEFAULT_COMPANY.BRANDING.MAX_UPLOAD_MB;
    if (file.size > (maxSizeMB as number) * 1024 * 1024) {
      toast({
        title: "File too large",
        description: `Max ${maxSizeMB}MB`,
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreviewUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSaveBranding = async () => {
    const errors: Record<string, string> = {};
    const finalCompanyName = String(
      companySettingsLocal.companyName || ""
    ).trim();
    if (!finalCompanyName) errors.companyName = "Company name is required";
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (selectedLogoFile) {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const b64 = reader.result?.toString().split(",")[1];
          b64 ? resolve(b64) : reject(new Error("Failed to read file"));
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(selectedLogoFile);
      try {
        const fileData = await base64Promise;
        await uploadLogoMutation.mutateAsync({
          fileName: selectedLogoFile.name,
          fileType: selectedLogoFile.type,
          fileData,
        });
        setSelectedLogoFile(null);
        setLogoPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch {
        return;
      }
    }

    const settingsToSave: BrandingUpdateRequest = {};
    if (companySettingsLocal.companyName !== undefined)
      settingsToSave.companyName = finalCompanyName;
    if (companySettingsLocal.primaryColor !== undefined)
      settingsToSave.primaryColor =
        companySettingsLocal.primaryColor ||
        DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR;
    if (Object.keys(settingsToSave).length > 0)
      updateCompanySettingsMutation.mutate(settingsToSave);
  };

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Customize your company branding to match your brand identity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-10">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            data-field="companyName"
            value={companySettingsLocal.companyName || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCompanySettingsLocal((p) => ({
                ...p,
                companyName: e.target.value,
              }))
            }
            placeholder="Enter company name"
            className={
              validationErrors?.companyName ? "border-destructive" : ""
            }
          />
          {validationErrors?.companyName && (
            <p className="text-sm text-destructive">
              {validationErrors.companyName}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-4">
              {logoPreviewUrl || companySettingsLocal.logoUrl ? (
                <div className="relative w-48 h-24 border rounded-lg overflow-hidden bg-gray-50">
                  <img
                    src={
                      logoPreviewUrl || (companySettingsLocal.logoUrl as string)
                    }
                    alt="Company Logo"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      // Fallback if image fails to load (e.g., expired presigned URL or invalid S3 URL)
                      console.warn("Logo preview failed to load");
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              ) : (
                <div className="w-48 h-24 border-2 border-dashed rounded-lg flex items-center justify-center bg-gray-50">
                  <Palette className="h-8 w-8 text-gray-400" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {logoPreviewUrl ? "Change Logo" : "Select Logo"}
                </Button>
                {logoPreviewUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedLogoFile(null);
                      setLogoPreviewUrl(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-xs text-destructive"
                  >
                    Clear
                  </Button>
                )}
                <p className="text-sm text-muted-foreground">
                  JPG or PNG, max {DEFAULT_COMPANY.BRANDING.MAX_UPLOAD_MB} MB
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <p className="text-sm text-muted-foreground">
              Your logo will appear in the navigation bar and on customer-facing
              documents.
            </p>
          </div>

          {/* Primary Color */}
          <div className="space-y-2">
            <Label>Primary Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={
                  companySettingsLocal.primaryColor ||
                  DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR
                }
                onChange={(e) =>
                  setCompanySettingsLocal((prev) => ({
                    ...prev,
                    primaryColor: e.target.value,
                  }))
                }
                className="h-9 w-12 rounded border"
              />
              <Input
                value={
                  companySettingsLocal.primaryColor ||
                  DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR
                }
                onChange={(e) =>
                  setCompanySettingsLocal((prev) => ({
                    ...prev,
                    primaryColor: e.target.value,
                  }))
                }
                placeholder={DEFAULT_COMPANY.BRANDING.PRIMARY_COLOR}
                className="w-36"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Used for accents and buttons across the app.
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button
          onClick={handleSaveBranding}
          disabled={uploadLogoMutation.isPending}
        >
          {uploadLogoMutation.isPending ? "Saving..." : "Save Branding"}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default BrandingTab;
