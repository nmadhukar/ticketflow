import { db } from "../db";
import { knowledgeArticles, users } from "@shared/schema";
import { eq } from "drizzle-orm";

interface SeedArticle {
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  // lifecycle and origin
  isPublished?: boolean;
  status?: "draft" | "published" | "archived";
  source?: "manual" | "ai_generated";
  // metrics
  viewCount?: number;
  helpfulVotes?: number;
  unhelpfulVotes?: number;
  usageCount?: number;
  effectivenessScore?: string; // decimal as string (e.g., "0.85")
  // audit/relations
  archivedAt?: Date | null;
  lastUsed?: Date | null;
  sourceTicketIds?: number[];
}

const DUMMY_ARTICLES: SeedArticle[] = [
  {
    title: "FAQ: Reset Password via Email Link",
    summary: "Use the emailed link to reset your password if you forgot it.",
    content:
      "If you receive a reset email: 1) Open the link within 15 minutes, 2) Set a new 12+ character password (mixed case, number, symbol), 3) Re-sign in on all devices. If the link expired, request a new reset from the login page.",
    category: "accounts",
    tags: ["password", "reset", "email"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Quick Fixes: VPN Not Connecting",
    summary: "Immediate checks when VPN fails on Windows or macOS.",
    content:
      "Try: 1) Verify internet access, 2) Correct system date/time, 3) Update VPN client, 4) Reboot device, 5) Ensure UDP/1194 (or IKEv2) open, 6) On macOS approve keychain prompts. If still failing, capture timestamp and error code.",
    category: "network",
    tags: ["vpn", "connectivity", "windows", "macos"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Reference: IMAP/SMTP Settings",
    summary: "Standard mail server settings for company email clients.",
    content:
      "IMAP: imap.ticketflow.local:993 (SSL)\nSMTP: smtp.ticketflow.local:587 (STARTTLS)\nUsername: your company email\nAuthentication: required\nIf you see auth errors, verify MFA/app password requirements.",
    category: "email",
    tags: ["imap", "smtp", "email", "settings"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Password Reset (Self-Service)",
    summary: "Reset your account password using the self-service portal.",
    content:
      'Prerequisites: Enrolled in MFA.\n\nSteps:\n1. Browse to https://password.company.com\n2. Click "Forgot Password" and enter your username\n3. Complete MFA verification\n4. Choose a new password (min 12 chars, mixed case + number + symbol)\n\nNotes:\n- Passwords expire every 90 days\n- If locked, wait 15 minutes or contact IT',
    category: "security",
    tags: ["password", "mfa", "account"],
    isPublished: true,
    status: "published",
    source: "manual",
    viewCount: 128,
    helpfulVotes: 18,
    unhelpfulVotes: 2,
    usageCount: 34,
    effectivenessScore: "0.90",
  },
  {
    title: "VPN Setup (Windows)",
    summary: "Configure company VPN on Windows 10/11.",
    content:
      "1. Settings > Network & Internet > VPN > Add a VPN connection\n2. Provider: Windows (built-in)\n3. Server: vpn.company.com; VPN type: IKEv2; Sign-in: Username/Password\n4. Save > Connect\n\nTroubleshooting:\n- Ensure device time is correct\n- Verify IKEv2 not blocked by local firewall",
    category: "network",
    tags: ["vpn", "windows", "remote"],
    isPublished: true,
    status: "published",
    source: "manual",
    viewCount: 72,
    helpfulVotes: 10,
    unhelpfulVotes: 1,
    usageCount: 21,
    effectivenessScore: "0.91",
  },
  {
    title: "VPN Setup (macOS)",
    summary: "Configure company VPN on macOS 12+.",
    content:
      "1. System Settings > VPN > Add VPN Configuration\n2. Type: IKEv2, Server: vpn.company.com, Remote ID: company.com\n3. Authentication: Username/Password\n4. Apply > Connect\n\nTroubleshooting:\n- Approve keychain prompts\n- Check certificate trust if prompted",
    category: "network",
    tags: ["vpn", "macos", "remote"],
    isPublished: true,
    status: "published",
    source: "manual",
    usageCount: 15,
  },
  {
    title: "Outlook Email Troubleshooting",
    summary: "Fix common Outlook connectivity and sync problems.",
    content:
      "Checklist:\n- Verify internet connectivity\n- Outlook > File > Office Account > Sign out/in\n- Update Office: File > Office Account > Update Options\n- Reset profile: Control Panel > Mail > Profiles > Add\n- Clear cache: Close Outlook, delete .OST for profile\n\nIf errors persist, capture error code and contact IT.",
    category: "email",
    tags: ["outlook", "email", "office365"],
    isPublished: true,
    status: "published",
    source: "manual",
    helpfulVotes: 6,
    unhelpfulVotes: 2,
    effectivenessScore: "0.75",
  },
  {
    title: "Microsoft Teams Notifications Fix",
    summary: "Resolve missing or delayed Teams notifications.",
    content:
      "1. Teams > Settings > Notifications: set to All activity\n2. Windows Focus Assist: Off (Settings > System > Focus)\n3. macOS Do Not Disturb: Off (Control Center)\n4. Allow Teams in OS notifications (System Settings > Notifications)\n5. Clear cache: Sign out, close Teams, delete cache folder, relaunch\n\nIf on VDI, enable background notifications.",
    category: "collaboration",
    tags: ["teams", "notifications", "windows", "macos"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Printer Installation (Windows)",
    summary: "Install a network printer via IP.",
    content:
      '1. Settings > Bluetooth & devices > Printers & scanners > Add device\n2. "The printer that I want isn’t listed" > Add by TCP/IP\n3. Address: 10.0.20.50, Port: 9100\n4. Use manufacturer driver or generic PCL\n5. Print test page\n\nTroubleshooting: Ensure on corporate Wi‑Fi/VPN.',
    category: "hardware",
    tags: ["printer", "windows", "drivers"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Install Software via Company Portal",
    summary: "Self-install approved apps from Company Portal.",
    content:
      "1. Open Company Portal (Start menu)\n2. Browse or search approved apps\n3. Click Install and keep device powered\n4. Reboot if prompted\n\nIf app not listed, submit a request with business justification.",
    category: "software",
    tags: ["intune", "company-portal", "self-service"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Wi‑Fi Connectivity Troubleshooting",
    summary: "Fix corporate Wi‑Fi connection issues.",
    content:
      "Checklist:\n- Forget and rejoin SSID Corp-Secure\n- Use username@company.com and password\n- Ensure date/time are correct\n- Disable VPN and third‑party firewall\n- Update Wi‑Fi driver via Device Manager\n\nEscalate with: SSID, location, time, MAC address.",
    category: "network",
    tags: ["wifi", "wireless", "connectivity"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "MFA Enrollment Guide",
    summary: "Enroll your device with Microsoft Authenticator.",
    content:
      "1. Browse to https://aka.ms/mfasetup and sign in\n2. Add sign-in method: Authenticator app\n3. Scan QR code in the app\n4. Approve test notification\n\nBackup: Enable cloud backup in Authenticator settings.",
    category: "security",
    tags: ["mfa", "authenticator", "account"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Laptop Won’t Boot (Basic Recovery)",
    summary: "First aid steps for a non-booting laptop.",
    content:
      "1. Unplug power; hold power button 15 seconds\n2. Reconnect power; try again\n3. Access BIOS (F2/Del) and confirm SSD is detected\n4. Run hardware diagnostics (F12)\n5. If BitLocker prompts appear, collect recovery key\n\nEscalate with photos and diagnostic codes.",
    category: "hardware",
    tags: ["boot", "bios", "bitlocker", "diagnostics"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Ticket Submission Best Practices",
    summary: "Write effective tickets for faster resolution.",
    content:
      "Include:\n- Clear title and business impact\n- Steps to reproduce and expected vs actual\n- Screenshots and exact error text\n- Device, OS, network (VPN/Wi‑Fi)\n- Time of occurrence\n\nUse one ticket per issue.",
    category: "process",
    tags: ["itil", "support", "how-to"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "New Employee Onboarding Checklist",
    summary: "Standard onboarding tasks for new hires.",
    content:
      "IT Tasks:\n- Create user, assign licenses (M365/E5)\n- Issue laptop with encryption and MDM\n- Provision VPN and MFA\n- Add to Teams channels and shared mailboxes\n- Share user guides\n\nManager Tasks: Role training, app access approvals.",
    category: "onboarding",
    tags: ["onboarding", "access", "devices"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  // Knowledge categories (general, troubleshooting, how-to, faq, technical, user-guide, system-admin, integration, performance)
  {
    title: "General: Resetting Application Cache",
    summary: "A general procedure to clear app caches across OSes.",
    content:
      "Windows: Settings > Apps > App > Storage > Clear cache\nmacOS: ~/Library/Caches/<App>\nLinux: ~/.cache/<App>\n\nReboot app and verify.",
    category: "general",
    tags: ["cache", "app", "general"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Troubleshooting: 502 Gateway Error",
    summary: "Steps to diagnose and resolve intermittent 502 errors.",
    content:
      "Check service health, CDN status, origin logs, and upstream timeouts; purge cache if needed.",
    category: "troubleshooting",
    tags: ["http", "gateway", "cdn"],
    status: "draft",
    isPublished: false,
    source: "manual",
  },
  {
    title: "How-To: Export Reports to CSV",
    summary: "Guide to exporting reports and large datasets.",
    content:
      "Use Export > CSV; for >100k rows, schedule asynchronous job and download from notifications.",
    category: "how-to",
    tags: ["reports", "export", "csv"],
    isPublished: true,
    status: "published",
    source: "manual",
    viewCount: 45,
  },
  {
    title: "FAQ: Why can’t I see my team’s tickets?",
    summary: "Visibility rules for team queues.",
    content:
      "Access depends on membership and department scope; request manager approval if needed.",
    category: "faq",
    tags: ["visibility", "teams", "rbac"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Technical: API Rate Limiting",
    summary: "Understanding 429 responses and backoff.",
    content:
      "Burst: 10 rps; Sustained: 1000/day. Implement exponential backoff, jitter, and idempotency keys.",
    category: "technical",
    tags: ["api", "429", "throttle"],
    status: "draft",
    isPublished: false,
    source: "manual",
  },
  {
    title: "System Admin: SSO Rollout Checklist",
    summary: "Steps for enabling SSO in production.",
    content:
      "1. Configure IdP\n2. Map groups to roles\n3. Test pilot users\n4. Enable staged rollout\n5. Monitor login failures.",
    category: "system-admin",
    tags: ["sso", "idp", "rollout"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Integration: Microsoft Teams Webhook Setup",
    summary: "Create an incoming webhook for ticket alerts.",
    content:
      "Teams > Channel > Connectors > Incoming Webhook; store URL in Admin > Integrations.",
    category: "integration",
    tags: ["teams", "webhook", "alerts"],
    isPublished: true,
    status: "published",
    source: "manual",
  },
  {
    title: "Performance: Speeding up Large Ticket Searches",
    summary: "Tips to reduce search latency for large datasets.",
    content:
      "Filter by category/date, use exact phrases, avoid leading wildcards; off-peak indexing.",
    category: "performance",
    tags: ["search", "performance", "index"],
    isPublished: true,
    status: "published",
    source: "manual",
    viewCount: 12,
  },
  // AI-generated draft article with related tickets
  {
    title: "Login Loop after Password Change",
    summary:
      "Resolving login loops caused by stale tokens after password reset.",
    content:
      "Sign out everywhere, clear browser/site data, restart device, and sign in with new credentials.",
    category: "troubleshooting",
    tags: ["login", "password", "token"],
    isPublished: false,
    status: "draft",
    source: "ai_generated",
    sourceTicketIds: [1011, 1019, 1042],
  },
  // Archived example
  {
    title: "Legacy VPN (PPTP) Setup",
    summary: "Deprecated: legacy PPTP instructions (for archive only).",
    content:
      "PPTP is deprecated and insecure. Use IKEv2. This article is kept for historical context only.",
    category: "network",
    tags: ["vpn", "pptp", "legacy"],
    isPublished: false,
    status: "archived",
    source: "manual",
    archivedAt: new Date(),
  },
];

export async function seedKnowledgeArticles() {
  try {
    console.log("Seeding knowledge articles...");

    // Prefer to attribute to the default admin if present
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@ticketflow.local"))
      .limit(1);

    for (const article of DUMMY_ARTICLES) {
      const [existing] = await db
        .select({ id: knowledgeArticles.id })
        .from(knowledgeArticles)
        .where(eq(knowledgeArticles.title, article.title))
        .limit(1);

      if (existing) {
        console.log(`Knowledge article already exists: ${article.title}`);
        continue;
      }

      await db.insert(knowledgeArticles).values({
        title: article.title,
        summary: article.summary,
        content: article.content,
        category: article.category,
        tags: article.tags,
        // lifecycle/source
        isPublished:
          article.isPublished !== undefined
            ? article.isPublished
            : article.status === "published",
        status:
          article.status !== undefined
            ? article.status
            : article.isPublished
            ? "published"
            : "draft",
        source: article.source || "manual",
        // metrics
        viewCount: article.viewCount ?? 0,
        helpfulVotes: article.helpfulVotes ?? 0,
        unhelpfulVotes: article.unhelpfulVotes ?? 0,
        usageCount: article.usageCount ?? 0,
        effectivenessScore: article.effectivenessScore ?? "0.00",
        // relations/audit
        archivedAt: article.archivedAt ?? null,
        lastUsed: article.lastUsed ?? null,
        sourceTicketIds: article.sourceTicketIds ?? [],
        createdBy: admin?.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`✓ Created knowledge article: ${article.title}`);
    }
  } catch (error) {
    console.error("Error seeding knowledge articles:", error);
    throw error;
  }
}
