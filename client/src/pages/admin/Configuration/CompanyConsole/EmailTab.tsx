import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
// Removed Tabs components; we render sections conditionally by activeTab
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, FileEdit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_COMPANY, EMAIL_PROVIDERS } from "@shared/constants";

const EmailTab = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [provider, setProvider] = useState<string>(EMAIL_PROVIDERS.MAILTRAP);
  const [emailSettings, setEmailSettings] = useState<any>({
    awsAccessKeyId: "",
    awsSecretAccessKey: "",
    awsRegion: "",
    fromEmail: DEFAULT_COMPANY.EMAIL.FROM_EMAIL,
    fromName: DEFAULT_COMPANY.EMAIL.FROM_NAME,
    mtToken: "",
  });

  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [isEditTemplateOpen, setIsEditTemplateOpen] = useState(false);
  const emailTemplates = [
    {
      name: "user_invitation",
      subject: "Welcome to TicketFlow",
      body: "Welcome to TicketFlow! You are now a member of our team.",
    },
    {
      name: "password_reset",
      subject: "Reset Your Password",
      body: "Click the link below to reset your password: [RESET_LINK]",
    },
    {
      name: "ticket_created",
      subject: "New Ticket Created",
      body: "A new ticket has been created: [TICKET_TITLE]\n\n[TICKET_DESCRIPTION]",
    },
    {
      name: "ticket_updated",
      subject: "Ticket Updated",
      body: "The ticket has been updated: [TICKET_TITLE]\n\n[TICKET_DESCRIPTION]",
    },
  ];

  const { data: smtpSettingsData } = useQuery({
    queryKey: ["/api/company-settings/email"],
    retry: false,
  });

  useEffect(() => {
    const data: any = smtpSettingsData;
    if (data) {
      if (data.provider) setProvider(data.provider);
      setEmailSettings({
        awsAccessKeyId: data.awsAccessKeyId || "",
        awsSecretAccessKey: "",
        awsRegion: data.awsRegion || "us-east-1",
        fromEmail: data.fromEmail || "noreply@dsigsoftware.com",
        fromName: data.fromName || "TicketFlow",
        mtToken: data.mtToken || "",
      });
    }
  }, [smtpSettingsData]);

  const { data } = useQuery({
    queryKey: ["/api/email-templates"],
    retry: false,
  });

  const saveEmailSettingsMutation = useMutation({
    mutationFn: async () => {
      let payload: any = {
        provider,
        fromEmail: emailSettings.fromEmail,
        fromName: emailSettings.fromName,
      };
      if (provider === EMAIL_PROVIDERS.MAILTRAP) {
        if (emailSettings.mtToken) payload.token = emailSettings.mtToken;
      } else if (provider === EMAIL_PROVIDERS.AWS) {
        payload.awsAccessKeyId = emailSettings.awsAccessKeyId;
        if (emailSettings.awsSecretAccessKey)
          payload.awsSecretAccessKey = emailSettings.awsSecretAccessKey;
        payload.awsRegion = emailSettings.awsRegion || "";
      } else if (provider === EMAIL_PROVIDERS.SMTP) {
        payload.host = emailSettings.host;
        payload.port = Number(emailSettings.port || 587);
        payload.username = emailSettings.username;
        if (emailSettings.password) payload.password = emailSettings.password;
        payload.encryption = emailSettings.encryption || "tls";
      } else if (provider === EMAIL_PROVIDERS.MAILGUN) {
        payload.domain = emailSettings.domain;
        payload.apiKey = emailSettings.apiKey;
        payload.region = emailSettings.mgRegion || "us";
      } else if (provider === EMAIL_PROVIDERS.SENDGRID) {
        payload.apiKey = emailSettings.sgApiKey;
      } else if (provider === EMAIL_PROVIDERS.CUSTOM) {
        try {
          payload.config = JSON.parse(emailSettings.customConfig || "{}");
        } catch {
          payload.config = {};
        }
      }
      // other providers can be added next
      return await apiRequest("POST", "/api/company-settings/email", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/company-settings/email"],
      });
      toast({
        title: "Success",
        description: "Email configuration saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save email configuration",
        variant: "destructive",
      });
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/company-settings/email/test", {
        testEmail: testEmailAddress,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Test email sent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send test email",
        variant: "destructive",
      });
    },
  });

  const updateEmailTemplateMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      subject: string;
      body: string;
    }) => {
      return await apiRequest("PATCH", "/api/company-settings/email/settings", {
        fromEmail: emailSettings.fromEmail,
        fromName: emailSettings.fromName,
        template: { name: data.name, subject: data.subject, body: data.body },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Success",
        description: "Email template updated successfully",
      });
      setIsEditTemplateOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update email template",
        variant: "destructive",
      });
    },
  });

  const saveSenderMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/company-settings/email/settings", {
        fromEmail: emailSettings.fromEmail,
        fromName: emailSettings.fromName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/company-settings/email"],
      });
      toast({ title: "Success", description: "Sender updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update sender",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <div className="flex flex-col gap-10">
        <Card>
          <CardHeader>
            <CardDescription>
              Configure your email provider and settings
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="font-medium">Email Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMAIL_PROVIDERS.MAILTRAP}>
                      Mailtrap
                    </SelectItem>
                    <SelectItem value={EMAIL_PROVIDERS.AWS}>AWS SES</SelectItem>
                    <SelectItem value={EMAIL_PROVIDERS.SMTP}>SMTP</SelectItem>
                    <SelectItem value={EMAIL_PROVIDERS.MAILGUN}>
                      Mailgun
                    </SelectItem>
                    <SelectItem value={EMAIL_PROVIDERS.SENDGRID}>
                      SendGrid
                    </SelectItem>
                    <SelectItem value={EMAIL_PROVIDERS.CUSTOM}>
                      Custom
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col items-center justify-center">
                <h3 className="text-lg font-semibold">Service Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    {(() => {
                      const hasAws =
                        !!emailSettings?.awsAccessKeyId &&
                        !!(
                          emailSettings?.awsSecretAccessKey ||
                          (smtpSettingsData as any)?.hasAwsSecret
                        ) &&
                        !!emailSettings?.awsRegion;
                      const hasMailtrap = Boolean(
                        emailSettings?.mtToken ||
                          (smtpSettingsData as any)?.mailtrapHasToken ||
                          (import.meta as any).env?.VITE_MAILTRAP_TOKEN
                      );
                      const hasSmtp = Boolean(
                        emailSettings?.host &&
                          emailSettings?.port &&
                          emailSettings?.username
                      );
                      const hasMailgun = Boolean(
                        emailSettings?.domain && emailSettings?.apiKey
                      );
                      const hasSendgrid = Boolean(emailSettings?.sgApiKey);
                      const hasCustom = Boolean(
                        emailSettings?.customConfig &&
                          emailSettings?.customConfig !== "{}"
                      );

                      const isConfigured =
                        provider === EMAIL_PROVIDERS.AWS
                          ? hasAws
                          : provider === EMAIL_PROVIDERS.MAILTRAP
                          ? hasMailtrap
                          : provider === EMAIL_PROVIDERS.SMTP
                          ? hasSmtp
                          : provider === EMAIL_PROVIDERS.MAILGUN
                          ? hasMailgun
                          : provider === EMAIL_PROVIDERS.SENDGRID
                          ? hasSendgrid
                          : provider === EMAIL_PROVIDERS.CUSTOM
                          ? hasCustom
                          : false;

                      const message =
                        provider === EMAIL_PROVIDERS.AWS
                          ? isConfigured
                            ? "AWS SES configured - Email features enabled"
                            : "AWS SES not configured - Email features disabled"
                          : provider === EMAIL_PROVIDERS.MAILTRAP
                          ? isConfigured
                            ? "Mailtrap configured - Email features enabled"
                            : "Mailtrap not configured - Provide API token"
                          : provider === EMAIL_PROVIDERS.SMTP
                          ? isConfigured
                            ? "SMTP configured - Email features enabled"
                            : "SMTP not configured - Enter host, port, username"
                          : provider === EMAIL_PROVIDERS.MAILGUN
                          ? isConfigured
                            ? "Mailgun configured - Email features enabled"
                            : "Mailgun not configured - Enter domain and API key"
                          : provider === EMAIL_PROVIDERS.SENDGRID
                          ? isConfigured
                            ? "SendGrid configured - Email features enabled"
                            : "SendGrid not configured - Enter API key"
                          : provider === EMAIL_PROVIDERS.CUSTOM
                          ? isConfigured
                            ? "Custom provider configured"
                            : "Custom provider not configured"
                          : "Configure your selected email provider";

                      return (
                        <>
                          <div
                            className={`w-3 h-3 rounded-full ${
                              isConfigured ? "bg-green-500" : "bg-yellow-500"
                            }`}
                          ></div>
                          <span className="text-sm">{message}</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {/* Warning for unsupported providers */}
              {provider !== EMAIL_PROVIDERS.MAILTRAP &&
                provider !== EMAIL_PROVIDERS.AWS && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Unsupported Email Provider</AlertTitle>
                    <AlertDescription>
                      Sorry, currently only AWS SES and Mailtrap are supported
                      for email sending. Please select one of these providers to
                      configure email functionality.
                    </AlertDescription>
                  </Alert>
                )}

              {provider === EMAIL_PROVIDERS.MAILTRAP && (
                <div id="email-integrations" className="space-y-4">
                  {!(import.meta as any).env?.VITE_MAILTRAP_TOKEN ? (
                    <div className="space-y-2">
                      <Label htmlFor="mt-token">Mailtrap API Token</Label>
                      <Input
                        id="mt-token"
                        type="password"
                        placeholder="Paste your Mailtrap token"
                        value={emailSettings?.mtToken || ""}
                        onChange={(e) =>
                          setEmailSettings({
                            ...emailSettings,
                            mtToken: e.target.value,
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Set MAILTRAP_TOKEN in server env for token-based
                        sending.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label>Mailtrap API Token</Label>
                      <p className="text-xs text-muted-foreground">
                        Token detected from environment.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {provider === EMAIL_PROVIDERS.AWS && (
                <div id="email-integrations" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="aws-access-key">
                      AWS Access Key ID (SES)
                    </Label>
                    <Input
                      id="aws-access-key"
                      placeholder="Enter your AWS Access Key ID for SES"
                      value={emailSettings?.awsAccessKeyId || ""}
                      onChange={(e) =>
                        setEmailSettings({
                          ...emailSettings,
                          awsAccessKeyId: e.target.value,
                        })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      IAM user access key with ses:SendEmail and
                      ses:SendRawEmail permissions
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="aws-secret-key">
                      AWS Secret Access Key (SES)
                    </Label>
                    <Input
                      id="aws-secret-key"
                      type="password"
                      placeholder="Enter your AWS Secret Access Key for SES"
                      value={emailSettings?.awsSecretAccessKey || ""}
                      onChange={(e) =>
                        setEmailSettings({
                          ...emailSettings,
                          awsSecretAccessKey: e.target.value,
                        })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Your AWS IAM user secret key for SES
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="aws-region">AWS Region (SES)</Label>
                    <Select
                      value={emailSettings?.awsRegion || "us-east-1"}
                      onValueChange={(value) =>
                        setEmailSettings({
                          ...emailSettings,
                          awsRegion: value,
                        })
                      }
                    >
                      <SelectTrigger id="aws-region">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="us-east-1">
                          US East (N. Virginia)
                        </SelectItem>
                        <SelectItem value="us-west-2">
                          US West (Oregon)
                        </SelectItem>
                        <SelectItem value="eu-west-1">EU (Ireland)</SelectItem>
                        <SelectItem value="eu-central-1">
                          EU (Frankfurt)
                        </SelectItem>
                        <SelectItem value="ap-southeast-1">
                          Asia Pacific (Singapore)
                        </SelectItem>
                        <SelectItem value="ap-southeast-2">
                          Asia Pacific (Sydney)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      The AWS region where SES is configured
                    </p>
                  </div>
                </div>
              )}
              {provider === EMAIL_PROVIDERS.SMTP && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">SMTP Host</Label>
                    <Input
                      id="smtp-host"
                      placeholder="smtp.example.com"
                      value={emailSettings?.host || ""}
                      onChange={(e) =>
                        setEmailSettings({
                          ...emailSettings,
                          host: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="smtp-port">Port</Label>
                      <Input
                        id="smtp-port"
                        type="number"
                        value={emailSettings?.port || 587}
                        onChange={(e) =>
                          setEmailSettings({
                            ...emailSettings,
                            port: Number(e.target.value || 587),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtp-enc">Encryption</Label>
                      <Select
                        value={emailSettings?.encryption || "tls"}
                        onValueChange={(v) =>
                          setEmailSettings({
                            ...emailSettings,
                            encryption: v,
                          })
                        }
                      >
                        <SelectTrigger id="smtp-enc">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tls">TLS</SelectItem>
                          <SelectItem value="ssl">SSL</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="smtp-user">Username</Label>
                      <Input
                        id="smtp-user"
                        value={emailSettings?.username || ""}
                        onChange={(e) =>
                          setEmailSettings({
                            ...emailSettings,
                            username: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtp-pass">Password</Label>
                      <Input
                        id="smtp-pass"
                        type="password"
                        value={emailSettings?.password || ""}
                        onChange={(e) =>
                          setEmailSettings({
                            ...emailSettings,
                            password: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              {provider === EMAIL_PROVIDERS.MAILGUN && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="mg-domain">Mailgun Domain</Label>
                    <Input
                      id="mg-domain"
                      placeholder="mg.example.com"
                      value={emailSettings?.domain || ""}
                      onChange={(e) =>
                        setEmailSettings({
                          ...emailSettings,
                          domain: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="mg-key">API Key</Label>
                      <Input
                        id="mg-key"
                        type="password"
                        value={emailSettings?.apiKey || ""}
                        onChange={(e) =>
                          setEmailSettings({
                            ...emailSettings,
                            apiKey: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mg-region">Region</Label>
                      <Select
                        value={emailSettings?.mgRegion || "us"}
                        onValueChange={(v) =>
                          setEmailSettings({ ...emailSettings, mgRegion: v })
                        }
                      >
                        <SelectTrigger id="mg-region">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="us">US</SelectItem>
                          <SelectItem value="eu">EU</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}

              {provider === EMAIL_PROVIDERS.SENDGRID && (
                <div className="space-y-2">
                  <Label htmlFor="sg-key">SendGrid API Key</Label>
                  <Input
                    id="sg-key"
                    type="password"
                    value={emailSettings?.sgApiKey || ""}
                    onChange={(e) =>
                      setEmailSettings({
                        ...emailSettings,
                        sgApiKey: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              {provider === EMAIL_PROVIDERS.CUSTOM && (
                <div className="space-y-2">
                  <Label htmlFor="custom-config">Custom Config (JSON)</Label>
                  <Textarea
                    id="custom-config"
                    value={emailSettings?.customConfig || "{}"}
                    onChange={(e) =>
                      setEmailSettings({
                        ...emailSettings,
                        customConfig: e.target.value,
                      })
                    }
                    className="font-mono text-sm h-40"
                  />
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => saveEmailSettingsMutation.mutate()}
              disabled={
                saveEmailSettingsMutation.isPending ||
                (provider !== EMAIL_PROVIDERS.MAILTRAP &&
                  provider !== EMAIL_PROVIDERS.AWS)
              }
            >
              {saveEmailSettingsMutation.isPending
                ? "Saving..."
                : "Save Configuration"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              Configure the sender email address and name for your email
              notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="space-y-2">
              <Label htmlFor="from-email">From Email Address</Label>
              <Input
                id="from-email"
                type="email"
                placeholder="noreply@yourcompany.com"
                value={emailSettings?.fromEmail || ""}
                onChange={(e) =>
                  setEmailSettings({
                    ...emailSettings,
                    fromEmail: e.target.value,
                  })
                }
              />
              <p className="text-sm text-muted-foreground">
                Ensure this email is verified/configured for your selected
                provider
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="from-name">From Name</Label>
              <Input
                id="from-name"
                placeholder="TicketFlow System"
                value={emailSettings?.fromName || "TicketFlow"}
                onChange={(e) =>
                  setEmailSettings({
                    ...emailSettings,
                    fromName: e.target.value,
                  })
                }
              />
              <p className="text-sm text-muted-foreground">
                The display name for system emails
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-4">
                Customize email templates for different system notifications
              </p>
              <div className="space-y-4">
                <Select
                  value={selectedTemplate?.name || ""}
                  onValueChange={(value) => {
                    const list: any[] = (data as any) || [];
                    const template = list.find((t: any) => t.name === value);
                    setSelectedTemplate(template);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template to edit" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.isArray(data) && data.length > 0 ? (
                      (data as any[]).map((tpl: any) => (
                        <SelectItem key={tpl.name} value={tpl.name}>
                          {tpl.name.replace(/_/g, " ")}
                        </SelectItem>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {data === undefined
                          ? "Loading templates…"
                          : "No templates found"}
                      </div>
                    )}
                  </SelectContent>
                </Select>

                {selectedTemplate && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditTemplateOpen(true);
                      }}
                    >
                      <FileEdit className="h-4 w-4 mr-2" />
                      Edit Template
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between">
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => saveSenderMutation.mutate()}
              disabled={saveSenderMutation.isPending}
            >
              {saveSenderMutation.isPending ? "Updating..." : "Update Settings"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Label>Send a test email to verify configuration</Label>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              id="test-email"
              type="email"
              placeholder="test@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
            />

            <Button
              variant="outline"
              onClick={() => testEmailMutation.mutate()}
              disabled={!testEmailAddress || testEmailMutation.isPending}
            >
              {testEmailMutation.isPending ? "Sending..." : "Send Test Email"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Edit Email Template Dialog */}
      <Dialog open={isEditTemplateOpen} onOpenChange={setIsEditTemplateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Email Template</DialogTitle>
            <DialogDescription>
              Customize the email template that will be sent to users
            </DialogDescription>
          </DialogHeader>
          {selectedTemplate && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input value={selectedTemplate.name} disabled />
              </div>

              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={selectedTemplate.subject || ""}
                  onChange={(e) =>
                    setSelectedTemplate({
                      ...selectedTemplate,
                      subject: e.target.value,
                    })
                  }
                  placeholder="Email subject line"
                />
              </div>

              <div className="space-y-2">
                <Label>Template Body (HTML)</Label>
                <Textarea
                  value={selectedTemplate.body || ""}
                  onChange={(e) =>
                    setSelectedTemplate({
                      ...selectedTemplate,
                      body: e.target.value,
                    })
                  }
                  placeholder="Email template HTML content"
                  className="font-mono text-sm h-96"
                />
              </div>

              <div className="space-y-2">
                <Label>Available Variables</Label>
                <div className="bg-muted p-3 rounded-md">
                  <p className="text-sm font-medium mb-2">
                    You can use these variables in your template:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplate.variables?.map((variable: string) => (
                      <code
                        key={variable}
                        className="bg-background px-2 py-1 rounded text-xs"
                      >
                        {`{{${variable}}}`}
                      </code>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsEditTemplateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    updateEmailTemplateMutation.mutate({
                      name: selectedTemplate.name,
                      subject: selectedTemplate.subject,
                      body: selectedTemplate.body,
                    });
                  }}
                  disabled={updateEmailTemplateMutation.isPending}
                >
                  {updateEmailTemplateMutation.isPending
                    ? "Saving..."
                    : "Save Template"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EmailTab;
