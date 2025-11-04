/**
 * Admin Panel - Comprehensive System Administration Interface
 *
 * Provides full administrative control over the TicketFlow system with:
 * - User Management: View, edit, approve, ban users with role assignments
 * - System Settings: Company branding, ticket numbering, email configuration
 * - API Key Management: Create, manage, and monitor API keys with proper security
 * - AWS Integration: Separate configuration for SES (email) and Bedrock (AI)
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
import LearningAnalytics from "@/pages/admin/AnalyticsInsights/learning-analytics";
import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
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
  "ai-analytics": <AiAnalytics />,
  "learning-queue": <LearningAnalytics />,
  guidelines: <AdminGuides />,
};

export default function AdminPanel() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [activeTab, setActiveTab] = useState("users");
  const [matchTabRoute, tabParams] = useRoute("/admin/:tab");

  useEffect(() => {
    const paramTab = (tabParams as any)?.tab as string | undefined;
    setActiveTab(paramTab || "users");
  }, [matchTabRoute, (tabParams as any)?.tab]);

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

  const sectionToRender = sections[activeTab] ?? sections["users"];

  return (
    <MainWrapper
      title="Admin Panel"
      subTitle="Manage Users, Teams, Invitations, Api, Policies, Configuration, AI Analytics, AI Settings and more"
    >
      {sectionToRender}
    </MainWrapper>
  );
}
