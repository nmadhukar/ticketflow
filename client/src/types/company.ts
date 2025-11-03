// Company Console typed payloads

// Branding
export interface BrandingSettingsResponse {
  companyName: string;
  logoUrl: string | null | undefined;
  primaryColor: string;
}

export interface BrandingUpdateRequest {
  companyName?: string;
  primaryColor?: string;
}

export interface BrandingLogoUploadRequest {
  fileName: string;
  fileType: string; // MIME type
  fileData: string; // base64 without data URL prefix
}

// Tickets
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface TicketsSettingsResponse {
  ticketPrefix: string;
  defaultTicketPriority: TicketPriority;
  autoCloseDays: number | null;
}

export interface TicketsUpdateRequest {
  ticketPrefix?: string;
  defaultTicketPriority?: TicketPriority;
  autoCloseDays?: number | null;
}

// Preferences
export type TimeFormat = "12h" | "24h";

export interface PreferencesSettingsResponse {
  timezone: string;
  dateFormat: string;
  timeFormat: TimeFormat;
  maxFileUploadSize: number;
  maintenanceMode: boolean;
}

export interface PreferencesUpdateRequest {
  timezone?: string;
  dateFormat?: string;
  timeFormat?: TimeFormat;
  maxFileUploadSize?: number;
  maintenanceMode?: boolean;
}

// Email (SMTP)
export interface EmailSettingsResponse {
  awsAccessKeyId: string;
  awsRegion: string;
  fromEmail: string;
  fromName: string;
  hasAwsSecret?: boolean;
}

export interface EmailSettingsRequest {
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string; // optional; when blank do not overwrite
  awsRegion?: string;
  fromEmail?: string;
  fromName?: string;
}

export interface EmailTestRequest {
  testEmail: string;
}
