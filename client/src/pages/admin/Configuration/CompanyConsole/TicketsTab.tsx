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
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { TICKET_PRIORITIES, DEFAULT_COMPANY } from "@shared/constants";
import type {
  TicketsSettingsResponse,
  TicketsUpdateRequest,
  TicketPriority,
} from "@/types/company";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

const TicketsTab = () => {
  const [companySettingsLocal, setCompanySettingsLocal] =
    useState<TicketsSettingsResponse>({
      ticketPrefix: "",
      defaultTicketPriority: "medium",
      autoCloseDays: null,
    });

  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const defaultTicketPriority = companySettingsLocal.defaultTicketPriority;
  const autoCloseDays = companySettingsLocal.autoCloseDays;
  // Initialize via GET /tickets
  const { data: ticketsData } = useQuery({
    queryKey: ["/api/company-settings/tickets"],
    retry: false,
  });

  useEffect(() => {
    if (ticketsData) {
      const d = ticketsData as TicketsSettingsResponse;
      setCompanySettingsLocal({
        ticketPrefix: d.ticketPrefix || "",
        defaultTicketPriority: (d.defaultTicketPriority ||
          "medium") as TicketPriority,
        autoCloseDays:
          d.autoCloseDays ?? DEFAULT_COMPANY.TICKETS.AUTO_CLOSE_DAYS,
      });
    }
  }, [ticketsData]);
  const priorities = [...TICKET_PRIORITIES];

  const onTicketPrefixChange = (v: string) => {
    setCompanySettingsLocal((p) => ({
      ...p,
      ticketPrefix: v
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10),
    }));
  };

  const onDefaultPriorityChange = (v: string) =>
    setCompanySettingsLocal((p) => ({
      ...p,
      defaultTicketPriority: v as TicketPriority,
    }));

  const onAutoCloseDaysChange = (v: number | null) =>
    setCompanySettingsLocal((p) => ({ ...p, autoCloseDays: v }));

  const updateCompanySettingsMutation = useMutation({
    mutationFn: async (data: TicketsUpdateRequest) =>
      apiRequest("PATCH", "/api/company-settings/tickets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/company-settings/tickets"],
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

  const handleSaveTickets = async () => {
    const errors: Record<string, string> = {};
    const ticketPrefix = String(companySettingsLocal.ticketPrefix || "").trim();
    if (!ticketPrefix) errors.ticketPrefix = "Ticket prefix is required";
    const days = companySettingsLocal.autoCloseDays;
    if (days !== null && days !== undefined) {
      if (isNaN(Number(days)) || Number(days) < 1 || Number(days) > 365)
        errors.autoCloseDays = "Auto-close days must be between 1 and 365";
    }
    if (!companySettingsLocal.defaultTicketPriority)
      errors.defaultTicketPriority = "Default priority is required";
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
    }
    updateCompanySettingsMutation.mutate({
      ticketPrefix,
      defaultTicketPriority: companySettingsLocal.defaultTicketPriority,
      autoCloseDays:
        companySettingsLocal.autoCloseDays === null
          ? null
          : Number(companySettingsLocal.autoCloseDays),
    });
  };
  const isSaving = updateCompanySettingsMutation.isPending || false;

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Configure your ticket settings to match your business needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-10">
        <div className="space-y-2">
          <Label>Ticket Number Prefix</Label>
          <Input
            data-field="ticketPrefix"
            value={companySettingsLocal.ticketPrefix || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onTicketPrefixChange(e.target.value)
            }
            placeholder="TKT"
            maxLength={10}
            className={
              validationErrors?.ticketPrefix ? "border-destructive" : ""
            }
          />
          <p className="text-sm text-muted-foreground">
            Prefix used for generating ticket numbers (max 10 characters,
            letters and numbers only)
          </p>
          {validationErrors?.ticketPrefix && (
            <p className="text-sm text-destructive">
              {validationErrors.ticketPrefix}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Default Ticket Priority</Label>
          <Select
            value={defaultTicketPriority}
            onValueChange={onDefaultPriorityChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select default priority" />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Default priority assigned to new tickets when not specified
          </p>
          {validationErrors?.defaultTicketPriority && (
            <p className="text-sm text-destructive">
              {validationErrors.defaultTicketPriority}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Auto-close Resolved Tickets After</Label>
          <Input
            type="number"
            min="1"
            max="365"
            value={autoCloseDays ? autoCloseDays.toString() : ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onAutoCloseDaysChange(
                e.target.value === "" ? null : parseInt(e.target.value, 10)
              )
            }
            placeholder="Enter days or leave empty to disable"
          />
          <p className="text-sm text-muted-foreground">
            Days after which resolved tickets are automatically closed (1-365).
            Leave empty to disable auto-close.
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSaveTickets} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Tickets"}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default TicketsTab;
