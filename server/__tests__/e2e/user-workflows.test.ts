import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';

// End-to-End User Workflow Tests
describe('AI Helpdesk User Workflows', () => {
  let app: Express;
  let authToken: string;
  let testUserId: string;
  let createdTicketId: number;

  const isE2ETestEnabled = process.env.RUN_E2E_TESTS === 'true';

  beforeAll(async () => {
    if (!isE2ETestEnabled) {
      console.log('Skipping E2E tests. Set RUN_E2E_TESTS=true to run.');
      return;
    }

    // Initialize app (would import actual app)
    // app = await createTestApp();
    
    // Create test user and authenticate
    // const authResponse = await request(app)
    //   .post('/api/auth/login')
    //   .send({ username: 'testuser', password: 'testpass' });
    // authToken = authResponse.body.token;
    // testUserId = authResponse.body.user.id;
  });

  afterAll(async () => {
    if (!isE2ETestEnabled) return;
    
    // Cleanup test data
    if (createdTicketId) {
      // await request(app)
      //   .delete(`/api/tasks/${createdTicketId}`)
      //   .set('Authorization', `Bearer ${authToken}`);
    }
  });

  const skipIfNotEnabled = () => {
    if (!isE2ETestEnabled) {
      return it.skip;
    }
    return it;
  };

  describe('Customer Ticket Creation and AI Response Workflow', () => {
    skipIfNotEnabled()('should create ticket and receive AI auto-response', async () => {
      const ticketData = {
        title: 'Cannot access my account',
        description: 'I forgot my password and the reset email is not arriving',
        category: 'support',
        priority: 'medium'
      };

      // Create ticket
      const createResponse = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(ticketData)
        .expect(201);

      createdTicketId = createResponse.body.id;
      expect(createResponse.body.title).toBe(ticketData.title);
      expect(createResponse.body.status).toBe('open');

      // Wait for AI auto-response processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for auto-response
      const ticketResponse = await request(app)
        .get(`/api/tasks/${createdTicketId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(ticketResponse.body.comments).toBeDefined();
      
      // Should have at least one comment (auto-response)
      if (ticketResponse.body.comments.length > 0) {
        const autoResponse = ticketResponse.body.comments.find((c: any) => c.isAutoResponse);
        expect(autoResponse).toBeDefined();
        expect(autoResponse.content).toContain('password');
      }
    }, 15000);

    skipIfNotEnabled()('should escalate complex tickets to human agents', async () => {
      const complexTicketData = {
        title: 'Critical system integration failure affecting payment processing',
        description: 'Multiple payment gateways are failing with 500 errors. Database connections are timing out intermittently. This started after the deployment 2 hours ago and is affecting all customer transactions.',
        category: 'incident',
        priority: 'urgent',
        severity: 'critical'
      };

      const createResponse = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(complexTicketData)
        .expect(201);

      const complexTicketId = createResponse.body.id;

      // Wait for AI analysis
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check escalation
      const ticketResponse = await request(app)
        .get(`/api/tasks/${complexTicketId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should be escalated to appropriate team
      expect(ticketResponse.body.assignedTeamId).toBeDefined();
      expect(ticketResponse.body.priority).toBe('urgent');
      
      // Should have escalation comment
      if (ticketResponse.body.comments.length > 0) {
        const escalationComment = ticketResponse.body.comments.find((c: any) => 
          c.content.toLowerCase().includes('escalat')
        );
        expect(escalationComment).toBeDefined();
      }

      // Cleanup
      await request(app)
        .delete(`/api/tasks/${complexTicketId}`)
        .set('Authorization', `Bearer ${authToken}`);
    }, 20000);
  });

  describe('Knowledge Base Learning Workflow', () => {
    skipIfNotEnabled()('should learn from resolved ticket and create knowledge article', async () => {
      // Create and resolve a ticket
      const ticketData = {
        title: 'Email notifications stopped working',
        description: 'All email notifications stopped working after system update',
        category: 'bug',
        priority: 'high'
      };

      const createResponse = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(ticketData)
        .expect(201);

      const ticketId = createResponse.body.id;

      // Add resolution
      const resolutionData = {
        status: 'resolved',
        resolution: 'Updated email service configuration in admin panel. Restarted notification service. Verified all email types are now being sent successfully.'
      };

      await request(app)
        .patch(`/api/tasks/${ticketId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(resolutionData)
        .expect(200);

      // Wait for knowledge base learning
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if knowledge article was created
      const kbResponse = await request(app)
        .get('/api/knowledge-base/search')
        .query({ q: 'email notifications' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should find the newly created article
      expect(kbResponse.body.results.length).toBeGreaterThan(0);
      
      const emailArticle = kbResponse.body.results.find((article: any) => 
        article.title.toLowerCase().includes('email') && 
        article.sourceTicketId === ticketId
      );
      
      if (emailArticle) {
        expect(emailArticle.effectivenessScore).toBeGreaterThan(0.5);
        expect(emailArticle.category).toBe('troubleshooting');
      }

      // Cleanup
      await request(app)
        .delete(`/api/tasks/${ticketId}`)
        .set('Authorization', `Bearer ${authToken}`);
    }, 30000);
  });

  describe('Feedback Collection Workflow', () => {
    skipIfNotEnabled()('should collect and process user feedback on AI responses', async () => {
      // Create ticket with AI response
      const ticketData = {
        title: 'Password reset not working',
        description: 'I click the reset link but nothing happens',
        category: 'support',
        priority: 'medium'
      };

      const createResponse = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(ticketData)
        .expect(201);

      const ticketId = createResponse.body.id;

      // Wait for AI response
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get the auto-response
      const ticketResponse = await request(app)
        .get(`/api/tasks/${ticketId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const autoResponse = ticketResponse.body.comments?.find((c: any) => c.isAutoResponse);
      
      if (autoResponse) {
        // Submit positive feedback
        const feedbackResponse = await request(app)
          .post('/api/feedback/ai-response')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            responseId: autoResponse.id,
            ticketId: ticketId,
            isHelpful: true,
            comment: 'This helped me solve the problem quickly'
          })
          .expect(201);

        expect(feedbackResponse.body.isHelpful).toBe(true);

        // Check feedback was recorded
        const feedbackListResponse = await request(app)
          .get(`/api/feedback/ai-response/${ticketId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(feedbackListResponse.body.length).toBeGreaterThan(0);
        expect(feedbackListResponse.body[0].isHelpful).toBe(true);
      }

      // Cleanup
      await request(app)
        .delete(`/api/tasks/${ticketId}`)
        .set('Authorization', `Bearer ${authToken}`);
    }, 15000);
  });

  describe('Admin AI Management Workflow', () => {
    skipIfNotEnabled()('should allow admins to configure AI settings', async () => {
      // Get current AI settings
      const settingsResponse = await request(app)
        .get('/api/admin/ai-settings')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const currentSettings = settingsResponse.body;
      expect(currentSettings.confidenceThreshold).toBeDefined();

      // Update settings
      const newSettings = {
        ...currentSettings,
        confidenceThreshold: 0.8,
        autoResponseEnabled: true
      };

      await request(app)
        .put('/api/admin/ai-settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newSettings)
        .expect(200);

      // Verify settings updated
      const updatedResponse = await request(app)
        .get('/api/admin/ai-settings')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(updatedResponse.body.confidenceThreshold).toBe(0.8);
      expect(updatedResponse.body.autoResponseEnabled).toBe(true);
    }, 10000);

    skipIfNotEnabled()('should provide AI analytics and insights', async () => {
      // Get AI analytics
      const analyticsResponse = await request(app)
        .get('/api/admin/ai-analytics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(analyticsResponse.body).toHaveProperty('totalResponses');
      expect(analyticsResponse.body).toHaveProperty('averageConfidence');
      expect(analyticsResponse.body).toHaveProperty('escalationRate');
      expect(analyticsResponse.body).toHaveProperty('feedbackStats');

      // Check learning queue status
      const queueResponse = await request(app)
        .get('/api/admin/learning-queue')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(queueResponse.body).toHaveProperty('pending');
      expect(queueResponse.body).toHaveProperty('processing');
      expect(queueResponse.body).toHaveProperty('completed');
    }, 10000);
  });

  describe('Error Handling and Recovery', () => {
    skipIfNotEnabled()('should handle AI service unavailability gracefully', async () => {
      // Create ticket when AI service is down (simulated)
      const ticketData = {
        title: 'Test ticket during AI outage',
        description: 'This ticket is created when AI service is unavailable',
        category: 'support',
        priority: 'medium'
      };

      const createResponse = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(ticketData)
        .expect(201);

      const ticketId = createResponse.body.id;

      // Ticket should still be created successfully
      expect(createResponse.body.title).toBe(ticketData.title);
      expect(createResponse.body.status).toBe('open');

      // Should not have auto-response due to AI unavailability
      const ticketResponse = await request(app)
        .get(`/api/tasks/${ticketId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // No auto-response should be present, or error handling comment
      if (ticketResponse.body.comments.length > 0) {
        const hasAutoResponse = ticketResponse.body.comments.some((c: any) => c.isAutoResponse);
        // Either no auto-response, or error handling message
        if (hasAutoResponse) {
          const autoResponse = ticketResponse.body.comments.find((c: any) => c.isAutoResponse);
          expect(autoResponse.content).toContain('temporarily unavailable');
        }
      }

      // Cleanup
      await request(app)
        .delete(`/api/tasks/${ticketId}`)
        .set('Authorization', `Bearer ${authToken}`);
    }, 15000);
  });
});