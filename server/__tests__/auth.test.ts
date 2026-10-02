import request from 'supertest';
import express from 'express';
import { setupAuth, hashPassword } from '../services/auth';
import { storage } from '../storage';

// Mock storage
jest.mock('../storage', () => ({
  storage: {
    getUserByEmail: jest.fn(),
    recordFailedLogin: jest.fn(),
    resetFailedLogins: jest.fn(),
    createUser: jest.fn(),
    upsertUser: jest.fn(),
    setPasswordResetToken: jest.fn(),
    getEmailTemplate: jest.fn(),
    getCompanySettings: jest.fn(),
    getActiveEmailProvider: jest.fn(),
    getUserInvitations: jest.fn(),
    getUserInvitationByToken: jest.fn(),
    markInvitationAccepted: jest.fn(),
  }
}));

describe('Auth Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    setupAuth(app);
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    const validUser = {
      email: 'test@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User'
    };

    it('should register a new user successfully', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);
      (storage.getUserInvitations as jest.Mock).mockResolvedValue([]);
      (storage.createUser as jest.Mock).mockResolvedValue({
        id: '123',
        ...validUser,
        role: 'customer',
        isApproved: false
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validUser);

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('pending admin approval');
      expect(storage.createUser).toHaveBeenCalled();
    });

    it('should reject registration with existing email', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue({ id: '123', password: 'hashed' });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validUser);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Email already registered');
    });

    it('should auto-approve invited users', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);
      (storage.getUserInvitationByToken as jest.Mock).mockResolvedValue({
        id: 1,
        email: validUser.email,
        role: 'user',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400000),
        departmentId: 1
      });
      (storage.createUser as jest.Mock).mockResolvedValue({
        id: '123',
        ...validUser,
        role: 'user',
        isApproved: true
      });
      (storage.markInvitationAccepted as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validUser, inviteToken: 'valid-token' });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('You can now log in');
      expect(storage.markInvitationAccepted).toHaveBeenCalledWith(1);
    });

    it('should refuse to set a password on an existing SSO account', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue({
        id: '123',
        email: validUser.email,
        password: null // No password set (SSO user)
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validUser);

      expect(response.status).toBe(409);
      expect(storage.upsertUser).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    // A successful login writes a session row, so it is covered against a real
    // database in integration/smoke.test.ts.
    it('should reject login with a wrong password', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue({
        id: '123',
        email: 'test@example.com',
        password: await hashPassword('the-right-password'),
        isApproved: true,
        isActive: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'the-wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid email or password');
    });

    it('should reject login for a deactivated account', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue({
        id: '123',
        email: 'test@example.com',
        password: await hashPassword('password123'),
        isApproved: true,
        isActive: false
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Account is deactivated');
    });

    it('should reject login with invalid email', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should send password reset email for existing user', async () => {
      const user = {
        id: '123',
        email: 'test@example.com'
      };

      (storage.getUserByEmail as jest.Mock).mockResolvedValue(user);
      (storage.setPasswordResetToken as jest.Mock).mockResolvedValue(undefined);
      // No template or provider configured: the token is stored, no email goes out.
      (storage.getEmailTemplate as jest.Mock).mockResolvedValue(undefined);
      (storage.getCompanySettings as jest.Mock).mockResolvedValue(undefined);
      (storage.getActiveEmailProvider as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('reset link');
      expect(storage.setPasswordResetToken).toHaveBeenCalledWith(
        '123',
        expect.any(String),
        expect.any(Date)
      );
    });

    it('should return generic message for non-existent email', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('reset link');
      expect(storage.setPasswordResetToken).not.toHaveBeenCalled();
    });
  });
});