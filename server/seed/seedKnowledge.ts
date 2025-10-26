import { db } from "../db";
import { knowledgeArticles, users } from "@shared/schema";
import { eq } from "drizzle-orm";

interface SeedArticle {
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  isPublished: boolean;
}

const DUMMY_ARTICLES: SeedArticle[] = [
  {
    title: "Password Reset (Self-Service)",
    summary: "Reset your account password using the self-service portal.",
    content:
      'Prerequisites: Enrolled in MFA.\n\nSteps:\n1. Browse to https://password.company.com\n2. Click "Forgot Password" and enter your username\n3. Complete MFA verification\n4. Choose a new password (min 12 chars, mixed case + number + symbol)\n\nNotes:\n- Passwords expire every 90 days\n- If locked, wait 15 minutes or contact IT',
    category: "security",
    tags: ["password", "mfa", "account"],
    isPublished: true,
  },
  {
    title: "VPN Setup (Windows)",
    summary: "Configure company VPN on Windows 10/11.",
    content:
      "1. Settings > Network & Internet > VPN > Add a VPN connection\n2. Provider: Windows (built-in)\n3. Server: vpn.company.com; VPN type: IKEv2; Sign-in: Username/Password\n4. Save > Connect\n\nTroubleshooting:\n- Ensure device time is correct\n- Verify IKEv2 not blocked by local firewall",
    category: "network",
    tags: ["vpn", "windows", "remote"],
    isPublished: true,
  },
  {
    title: "VPN Setup (macOS)",
    summary: "Configure company VPN on macOS 12+.",
    content:
      "1. System Settings > VPN > Add VPN Configuration\n2. Type: IKEv2, Server: vpn.company.com, Remote ID: company.com\n3. Authentication: Username/Password\n4. Apply > Connect\n\nTroubleshooting:\n- Approve keychain prompts\n- Check certificate trust if prompted",
    category: "network",
    tags: ["vpn", "macos", "remote"],
    isPublished: true,
  },
  {
    title: "Outlook Email Troubleshooting",
    summary: "Fix common Outlook connectivity and sync problems.",
    content:
      "Checklist:\n- Verify internet connectivity\n- Outlook > File > Office Account > Sign out/in\n- Update Office: File > Office Account > Update Options\n- Reset profile: Control Panel > Mail > Profiles > Add\n- Clear cache: Close Outlook, delete .OST for profile\n\nIf errors persist, capture error code and contact IT.",
    category: "email",
    tags: ["outlook", "email", "office365"],
    isPublished: true,
  },
  {
    title: "Microsoft Teams Notifications Fix",
    summary: "Resolve missing or delayed Teams notifications.",
    content:
      "1. Teams > Settings > Notifications: set to All activity\n2. Windows Focus Assist: Off (Settings > System > Focus)\n3. macOS Do Not Disturb: Off (Control Center)\n4. Allow Teams in OS notifications (System Settings > Notifications)\n5. Clear cache: Sign out, close Teams, delete cache folder, relaunch\n\nIf on VDI, enable background notifications.",
    category: "collaboration",
    tags: ["teams", "notifications", "windows", "macos"],
    isPublished: true,
  },
  {
    title: "Printer Installation (Windows)",
    summary: "Install a network printer via IP.",
    content:
      '1. Settings > Bluetooth & devices > Printers & scanners > Add device\n2. "The printer that I want isn’t listed" > Add by TCP/IP\n3. Address: 10.0.20.50, Port: 9100\n4. Use manufacturer driver or generic PCL\n5. Print test page\n\nTroubleshooting: Ensure on corporate Wi‑Fi/VPN.',
    category: "hardware",
    tags: ["printer", "windows", "drivers"],
    isPublished: true,
  },
  {
    title: "Install Software via Company Portal",
    summary: "Self-install approved apps from Company Portal.",
    content:
      "1. Open Company Portal (Start menu)\n2. Browse or search approved apps\n3. Click Install and keep device powered\n4. Reboot if prompted\n\nIf app not listed, submit a request with business justification.",
    category: "software",
    tags: ["intune", "company-portal", "self-service"],
    isPublished: true,
  },
  {
    title: "Wi‑Fi Connectivity Troubleshooting",
    summary: "Fix corporate Wi‑Fi connection issues.",
    content:
      "Checklist:\n- Forget and rejoin SSID Corp-Secure\n- Use username@company.com and password\n- Ensure date/time are correct\n- Disable VPN and third‑party firewall\n- Update Wi‑Fi driver via Device Manager\n\nEscalate with: SSID, location, time, MAC address.",
    category: "network",
    tags: ["wifi", "wireless", "connectivity"],
    isPublished: true,
  },
  {
    title: "MFA Enrollment Guide",
    summary: "Enroll your device with Microsoft Authenticator.",
    content:
      "1. Browse to https://aka.ms/mfasetup and sign in\n2. Add sign-in method: Authenticator app\n3. Scan QR code in the app\n4. Approve test notification\n\nBackup: Enable cloud backup in Authenticator settings.",
    category: "security",
    tags: ["mfa", "authenticator", "account"],
    isPublished: true,
  },
  {
    title: "Laptop Won’t Boot (Basic Recovery)",
    summary: "First aid steps for a non-booting laptop.",
    content:
      "1. Unplug power; hold power button 15 seconds\n2. Reconnect power; try again\n3. Access BIOS (F2/Del) and confirm SSD is detected\n4. Run hardware diagnostics (F12)\n5. If BitLocker prompts appear, collect recovery key\n\nEscalate with photos and diagnostic codes.",
    category: "hardware",
    tags: ["boot", "bios", "bitlocker", "diagnostics"],
    isPublished: true,
  },
  {
    title: "Ticket Submission Best Practices",
    summary: "Write effective tickets for faster resolution.",
    content:
      "Include:\n- Clear title and business impact\n- Steps to reproduce and expected vs actual\n- Screenshots and exact error text\n- Device, OS, network (VPN/Wi‑Fi)\n- Time of occurrence\n\nUse one ticket per issue.",
    category: "process",
    tags: ["itil", "support", "how-to"],
    isPublished: true,
  },
  {
    title: "New Employee Onboarding Checklist",
    summary: "Standard onboarding tasks for new hires.",
    content:
      "IT Tasks:\n- Create user, assign licenses (M365/E5)\n- Issue laptop with encryption and MDM\n- Provision VPN and MFA\n- Add to Teams channels and shared mailboxes\n- Share user guides\n\nManager Tasks: Role training, app access approvals.",
    category: "onboarding",
    tags: ["onboarding", "access", "devices"],
    isPublished: true,
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
        isPublished: article.isPublished,
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
