/**
 * Admin Panel - Comprehensive System Administration Interface
 *
 * Provides full administrative control over the TicketFlow system with:
 * - User Management: View, edit, approve, ban users with role assignments
 * - System Settings: Company branding, ticket numbering, email configuration
 * - API Key Management: Create, manage, and monitor API keys with proper security
 * - AWS Integration: SES email and S3 storage settings are separate from OpenRouter AI.
 * - Microsoft 365 SSO: Configure enterprise authentication integration
 * - Help Documentation: Manage help documents and policy files for AI chatbot
 * - Email Templates: Customize system email templates for various events
 * - Audit and Monitoring: Track system usage and user activities
 *
 * Security Features:
 * - Role-based access control (admin-only access)
 * - Secure API key generation and management
 * - Input validation and sanitization
 * - Audit logging for administrative actions
 *
 * The panel uses a tabbed interface for organization and includes:
 * - Real-time data updates and validation
 * - Bulk operations for user management
 * - Configuration testing and validation
 * - Visual indicators for system status
 */

import MainWrapper from "@/components/main-wrapper";
import { useAuth } from "@/hooks/useAuth";
import HelpDocs from "@/pages/admin/DocsGuides/HelpDocs";
import Policies from "@/pages/admin/DocsGuides/Policies";
import Invitations from "@/pages/admin/UsersGroups/invitations";
import AiAnalytics from "@/pages/admin/AnalyticsInsights/ai-analytics";
import AISettings from "@/pages/admin/Configuration/ai-settings";
import StorageSettings from "@/pages/admin/Configuration/storage-settings";
import LearningAnalytics from "@/pages/admin/AnalyticsInsights/learning-analytics";
import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import CompanyConsole from "./Configuration/CompanyConsole";
import AdminGuides from "./DocsGuides/admin-guides";
import DeveloperResources from "./Integrations/DeveloperResources";
import Ms365Sso from "./Integrations/Ms365Sso";
import MsTeamIntegration from "./Integrations/MsTeamIntegration";
import Teams from "./UsersGroups/Teams";
import Users from "./UsersGroups/Users";

const sections: Record<string, JSX.Element> = {
  users: <Users />,
  invitations: <Invitations />,
  teams: <Teams />,
  "developer-resources": <DeveloperResources />,
  "company-console": <CompanyConsole />,
  help: <HelpDocs />,
  policies: <Policies />,
  sso: <Ms365Sso />,
  "ms-teams-integration": <MsTeamIntegration />,
  "ai-settings": <AISettings />,
  "storage-settings": <StorageSettings />,
  "ai-analytics": <AiAnalytics />,
  "learning-queue": <LearningAnalytics />,
  guidelines: <AdminGuides />,
};

export default function AdminPanel() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [, tabParams] = useRoute("/admin/:tab");
  const activeTab = tabParams?.tab || "users";

  // Deep-link support for section navigation via ?section=... for any active tab
  // Tries multiple id patterns to be resilient across sections/components
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (!section) return;

    // Candidate element IDs to try
    const candidates = [
      `${activeTab}-${section}`, // e.g., ai-analytics-analytics
      `${section}-${activeTab}`, // fallback
      `${section}`, // generic id
      `${activeTab}__${section}`, // alternate delimiter
    ];

    for (const id of candidates) {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }, [activeTab]);

  // Check if user is admin
  if ((user as any)?.role !== "admin") {
    setLocation("/");
    return null;
  }

  const sectionToRender = Object.hasOwn(sections, activeTab) ? sections[activeTab] : <div role="alert" className="rounded-xl border bg-card p-8"><h1 className="text-xl font-semibold">Admin page not found</h1><p className="mt-2 text-sm text-muted-foreground">Choose a section from navigation, or return to user management.</p><Button asChild className="mt-4"><Link href="/admin/users">Go to users</Link></Button></div>;

  return <MainWrapper>{sectionToRender}</MainWrapper>;
}
