import { db } from "../db";
import {
  helpDocuments,
  userGuides,
  userGuideCategories,
  users,
} from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedHelpAndDocs() {
  try {
    console.log("Seeding Help Documentation and User Guides...");

    // Prefer to attribute uploads to default admin if present
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@ticketflow.local"))
      .limit(1);

    // --- Help Documents (Word docs stored as base64) ---
    const helpSeeds = [
      {
        title: "Employee Handbook",
        filename: "Employee_Handbook.docx",
        category: "Policies",
        tags: ["hr", "policy", "handbook"],
        content:
          "Company policies, code of conduct, and employment guidelines (sample).",
        // Lightweight sample base64 content (not a real DOCX, sufficient for seed/demo)
        fileData: Buffer.from("Sample Employee Handbook content").toString(
          "base64"
        ),
      },
      {
        title: "IT Security Policy",
        filename: "IT_Security_Policy.docx",
        category: "Security",
        tags: ["security", "it", "policy"],
        content:
          "Acceptable use, password policy, incident response procedures (sample).",
        fileData: Buffer.from("Sample IT Security Policy content").toString(
          "base64"
        ),
      },
    ];

    for (const doc of helpSeeds) {
      const [existing] = await db
        .select({ id: helpDocuments.id })
        .from(helpDocuments)
        .where(eq(helpDocuments.filename, doc.filename))
        .limit(1);
      if (!existing) {
        await db.insert(helpDocuments).values({
          title: doc.title,
          filename: doc.filename,
          content: doc.content,
          fileData: doc.fileData,
          uploadedBy: admin?.id,
          category: doc.category,
          tags: doc.tags,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`✓ Created help document: ${doc.title}`);
      }
    }

    // --- User Guide Categories ---
    const categories = [
      {
        name: "Getting Started",
        description: "Onboarding and basics",
        icon: "rocket",
        displayOrder: 1,
      },
      {
        name: "Advanced Features",
        description: "Power-user workflows",
        icon: "zap",
        displayOrder: 2,
      },
      {
        name: "Troubleshooting",
        description: "Common issues and fixes",
        icon: "wrench",
        displayOrder: 3,
      },
    ];

    for (const cat of categories) {
      const [existingCat] = await db
        .select({ id: userGuideCategories.id })
        .from(userGuideCategories)
        .where(eq(userGuideCategories.name, cat.name))
        .limit(1);
      if (!existingCat) {
        await db.insert(userGuideCategories).values({
          name: cat.name,
          description: cat.description,
          icon: cat.icon,
          displayOrder: cat.displayOrder,
          createdAt: new Date(),
        });
        console.log(`✓ Created guide category: ${cat.name}`);
      }
    }

    // --- User Guides (HTML / Scribehow / Video) ---
    const guideSeeds = [
      {
        title: "How to Create a Ticket",
        description: "Step-by-step to submit a support ticket",
        category: "Getting Started",
        type: "html",
        tags: ["tickets", "how-to"],
        content:
          '<h2>Submit a Ticket</h2><ol><li>Click "New Ticket"</li><li>Fill in details</li><li>Attach screenshots</li><li>Submit</li></ol>',
      },
      {
        title: "Using the Ticket Workflow (Scribehow)",
        description: "Interactive walkthrough of ticket lifecycle",
        category: "Advanced Features",
        type: "scribehow",
        tags: ["scribehow", "workflow"],
        scribehowUrl: "https://scribehow.com/shared/example",
        content:
          '<div class="scribehow-embed">Scribehow embed placeholder</div>',
      },
      {
        title: "Understanding Priority Levels (Video)",
        description: "Video overview of priority definitions",
        category: "Getting Started",
        type: "video",
        tags: ["video", "priority"],
        videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        content:
          '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Video" frameborder="0" allowfullscreen></iframe>',
      },
    ];

    for (const guide of guideSeeds) {
      const [existingGuide] = await db
        .select({ id: userGuides.id })
        .from(userGuides)
        .where(eq(userGuides.title, guide.title))
        .limit(1);

      if (!existingGuide) {
        await db.insert(userGuides).values({
          title: guide.title,
          description: guide.description,
          category: guide.category,
          type: guide.type,
          content: guide.content,
          scribehowUrl: (guide as any).scribehowUrl,
          videoUrl: (guide as any).videoUrl,
          tags: guide.tags,
          isPublished: true,
          viewCount: 0,
          createdBy: admin?.id || "system",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`✓ Created user guide: ${guide.title}`);
      }
    }

    console.log("Help Documentation and User Guides seeding completed.");
  } catch (error) {
    console.error("Error seeding Help & Docs:", error);
    throw error;
  }
}
