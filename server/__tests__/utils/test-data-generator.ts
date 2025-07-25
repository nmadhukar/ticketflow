import { faker } from '@faker-js/faker';

// Test Data Generator for AI Helpdesk Testing
export class TestDataGenerator {
  
  // Generate realistic ticket data
  static generateTickets(count: number): any[] {
    const categories = ['support', 'bug', 'enhancement', 'incident'];
    const priorities = ['low', 'medium', 'high', 'urgent'];
    const severities = ['minor', 'normal', 'major', 'critical'];
    const statuses = ['open', 'in_progress', 'resolved', 'closed'];
    
    const ticketTemplates = [
      {
        title: "Cannot log into my account",
        description: "I'm trying to log in but it says invalid credentials. I'm sure my password is correct.",
        category: "support",
        keywords: ["login", "authentication", "password", "credentials"]
      },
      {
        title: "Application crashes on startup",
        description: "The app crashes immediately when I try to open it. This started happening after the latest update.",
        category: "bug",
        keywords: ["crash", "startup", "update", "error"]
      },
      {
        title: "Slow performance during peak hours",
        description: "The system becomes very slow between 2-4 PM when many users are online. Page load times exceed 30 seconds.",
        category: "incident",
        keywords: ["performance", "slow", "peak", "load", "timeout"]
      },
      {
        title: "Email notifications not working",
        description: "I'm not receiving any email notifications for new messages or updates. My email settings look correct.",
        category: "bug",
        keywords: ["email", "notifications", "messages", "settings"]
      },
      {
        title: "Feature request: Dark mode",
        description: "Would like to have a dark mode option for better viewing during night time work sessions.",
        category: "enhancement",
        keywords: ["feature", "dark", "mode", "theme", "night"]
      },
      {
        title: "Database connection timeout",
        description: "Getting frequent database connection timeout errors. This affects multiple services and user sessions.",
        category: "incident",
        keywords: ["database", "connection", "timeout", "error", "session"]
      },
      {
        title: "Password reset not working",
        description: "The password reset email never arrives. I've checked spam folder and tried multiple times.",
        category: "support",
        keywords: ["password", "reset", "email", "spam", "not working"]
      },
      {
        title: "File upload fails for large files",
        description: "Cannot upload files larger than 10MB. The upload process starts but fails after a few minutes with no error message.",
        category: "bug",
        keywords: ["upload", "file", "large", "fails", "timeout"]
      }
    ];

    return Array.from({ length: count }, (_, i) => {
      const template = ticketTemplates[i % ticketTemplates.length];
      
      return {
        id: i + 1,
        ticketNumber: `TKT-2024-${String(i + 1).padStart(4, '0')}`,
        title: `${template.title} - ${faker.company.name()}`,
        description: this.addVariationToDescription(template.description),
        category: faker.helpers.arrayElement(categories),
        priority: faker.helpers.arrayElement(priorities),
        severity: faker.helpers.arrayElement(severities),
        status: faker.helpers.arrayElement(statuses),
        createdBy: faker.string.uuid(),
        createdAt: faker.date.recent({ days: 30 }),
        updatedAt: faker.date.recent({ days: 5 }),
        tags: this.generateTags(template.keywords),
        complexity: faker.number.int({ min: 10, max: 100 })
      };
    });
  }

  // Add variation to description to make it more realistic
  private static addVariationToDescription(baseDescription: string): string {
    const variations = [
      " This is urgent as it's affecting my work.",
      " Please help as soon as possible.",
      " I've tried restarting but the issue persists.",
      " This worked fine yesterday but not today.",
      " My colleagues are experiencing the same issue.",
      " I need this resolved before the deadline.",
      " This is the second time this has happened.",
      " I'm on version " + faker.system.semver() + ".",
      " Using " + faker.internet.userAgent() + ".",
      " Error code: " + faker.string.alphanumeric(8).toUpperCase()
    ];

    const shouldAddVariation = faker.datatype.boolean();
    if (shouldAddVariation) {
      return baseDescription + faker.helpers.arrayElement(variations);
    }
    return baseDescription;
  }

  // Generate realistic tags
  private static generateTags(keywords: string[]): string[] {
    const additionalTags = ['urgent', 'customer', 'internal', 'reported', 'verified'];
    const selectedKeywords = faker.helpers.arrayElements(keywords, { min: 1, max: 3 });
    const selectedAdditional = faker.helpers.arrayElements(additionalTags, { min: 0, max: 2 });
    
    return [...selectedKeywords, ...selectedAdditional];
  }

  // Generate knowledge base articles
  static generateKnowledgeArticles(count: number): any[] {
    const categories = ['troubleshooting', 'how-to', 'faq', 'technical', 'general'];
    
    const articleTemplates = [
      {
        title: "How to Reset Your Password",
        summary: "Step-by-step guide for password reset",
        content: "To reset your password: 1. Click 'Forgot Password' 2. Enter your email 3. Check inbox for reset link 4. Follow the link and create a new password",
        category: "how-to",
        tags: ["password", "reset", "authentication", "login"]
      },
      {
        title: "Troubleshooting Login Issues",
        summary: "Common solutions for login problems",
        content: "Common login issues: 1. Clear browser cache and cookies 2. Check caps lock 3. Try incognito mode 4. Contact support if issues persist",
        category: "troubleshooting",
        tags: ["login", "troubleshooting", "browser", "authentication"]
      },
      {
        title: "File Upload Best Practices",
        summary: "Guidelines for successful file uploads",
        content: "For successful uploads: 1. Check file size limits 2. Use supported formats 3. Ensure stable internet 4. Try smaller files if issues occur",
        category: "how-to",
        tags: ["upload", "files", "best-practices", "guidelines"]
      }
    ];

    return Array.from({ length: count }, (_, i) => {
      const template = articleTemplates[i % articleTemplates.length];
      
      return {
        id: i + 1,
        title: `${template.title} - ${faker.company.buzzPhrase()}`,
        summary: template.summary,
        content: `${template.content}\n\nAdditional details: ${faker.lorem.paragraph()}`,
        category: faker.helpers.arrayElement(categories),
        tags: template.tags,
        isPublished: faker.datatype.boolean({ probability: 0.8 }),
        effectivenessScore: faker.number.float({ min: 0.4, max: 1.0, fractionDigits: 2 }),
        usageCount: faker.number.int({ min: 0, max: 100 }),
        helpfulCount: faker.number.int({ min: 0, max: 50 }),
        sourceTicketId: faker.datatype.boolean({ probability: 0.3 }) ? faker.number.int({ min: 1, max: 1000 }) : null,
        createdAt: faker.date.recent({ days: 90 }),
        updatedAt: faker.date.recent({ days: 30 }),
        createdBy: faker.string.uuid()
      };
    });
  }

  // Generate AI response test scenarios
  static generateAIResponseScenarios(): any[] {
    return [
      {
        name: "High Confidence Auth Issue",
        ticket: {
          title: "Cannot log in with correct password",
          description: "I'm entering the right password but getting 'invalid credentials' error",
          category: "support"
        },
        expectedConfidence: { min: 0.8, max: 1.0 },
        expectedKeywords: ["password", "reset", "credentials", "login"],
        shouldAutoRespond: true
      },
      {
        name: "Medium Confidence Technical Issue",
        ticket: {
          title: "Application performance is slow",
          description: "The app takes a long time to load pages and sometimes times out",
          category: "technical"
        },
        expectedConfidence: { min: 0.5, max: 0.8 },
        expectedKeywords: ["performance", "slow", "cache", "optimization"],
        shouldAutoRespond: false
      },
      {
        name: "Low Confidence Vague Issue",
        ticket: {
          title: "Something is broken",
          description: "It doesn't work properly",
          category: "bug"
        },
        expectedConfidence: { min: 0.0, max: 0.4 },
        expectedKeywords: ["specific", "details", "reproduce"],
        shouldAutoRespond: false
      },
      {
        name: "Complex Multi-System Issue",
        ticket: {
          title: "Payment system integration failure",
          description: "Multiple payment gateways failing with 500 errors, affecting checkout, billing, and reporting systems",
          category: "incident",
          priority: "urgent",
          severity: "critical"
        },
        expectedConfidence: { min: 0.2, max: 0.6 },
        expectedKeywords: ["escalation", "technical", "investigation"],
        shouldAutoRespond: false,
        shouldEscalate: true
      }
    ];
  }

  // Generate load testing data
  static generateLoadTestData(ticketCount: number, concurrentUsers: number): any {
    return {
      tickets: this.generateTickets(ticketCount),
      users: Array.from({ length: concurrentUsers }, (_, i) => ({
        id: faker.string.uuid(),
        username: faker.internet.userName(),
        email: faker.internet.email(),
        role: faker.helpers.arrayElement(['customer', 'agent', 'admin'])
      })),
      testDuration: '5 minutes',
      expectedThroughput: Math.floor(ticketCount / (5 * 60)), // tickets per second
      maxResponseTime: 5000, // 5 seconds
      errorThreshold: 0.05 // 5% error rate
    };
  }

  // Generate feedback test data
  static generateFeedbackData(count: number): any[] {
    const feedbackTypes = ['helpful', 'not_helpful', 'incorrect', 'incomplete'];
    const ratings = [1, 2, 3, 4, 5];
    
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      responseId: faker.number.int({ min: 1, max: 1000 }),
      ticketId: faker.number.int({ min: 1, max: 1000 }),
      userId: faker.string.uuid(),
      feedbackType: faker.helpers.arrayElement(feedbackTypes),
      rating: faker.helpers.arrayElement(ratings),
      comment: faker.lorem.sentence(),
      isHelpful: faker.datatype.boolean({ probability: 0.7 }),
      createdAt: faker.date.recent({ days: 30 })
    }));
  }

  // Generate escalation test scenarios
  static generateEscalationScenarios(): any[] {
    return [
      {
        name: "High Complexity Technical Issue",
        ticket: {
          title: "Database corruption affecting multiple services",
          description: "Critical database corruption detected. Multiple services are failing. Data integrity compromised.",
          complexity: 95,
          priority: "urgent",
          severity: "critical"
        },
        shouldEscalate: true,
        expectedTeam: "technical",
        expectedTimeframe: "immediate"
      },
      {
        name: "Security Breach Report",
        ticket: {
          title: "Suspected unauthorized access to user accounts",
          description: "Multiple users reporting unusual activity. Potential security breach detected.",
          complexity: 90,
          priority: "urgent",
          severity: "critical"
        },
        shouldEscalate: true,
        expectedTeam: "security",
        expectedTimeframe: "immediate"
      },
      {
        name: "Simple Password Reset",
        ticket: {
          title: "Need help resetting password",
          description: "I forgot my password and need to reset it",
          complexity: 15,
          priority: "low",
          severity: "minor"
        },
        shouldEscalate: false,
        expectedResolution: "automated"
      }
    ];
  }

  // Generate performance benchmark data
  static generatePerformanceBenchmarks(): any {
    return {
      baselineMetrics: {
        avgResponseTime: 250, // ms
        throughput: 100, // requests per second
        memoryUsage: 50, // MB
        cpuUsage: 30 // percentage
      },
      loadTestScenarios: [
        { users: 10, duration: 60, expectedResponseTime: 300 },
        { users: 50, duration: 300, expectedResponseTime: 500 },
        { users: 100, duration: 600, expectedResponseTime: 1000 },
        { users: 200, duration: 900, expectedResponseTime: 2000 }
      ],
      acceptableThresholds: {
        maxResponseTime: 5000, // ms
        maxMemoryIncrease: 100, // MB
        maxErrorRate: 0.05, // 5%
        minSuccessRate: 0.95 // 95%
      }
    };
  }
}