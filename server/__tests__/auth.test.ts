import request from 'supertest';
import express from 'express';
import { setupAuth, hashPassword } from '../services/auth';
import { storage } from '../storage';

// Mock storage
jest.mock('../storage', () => ({
  storage: {
    getUserByEmail: jest.fn(),
    claimLoginAttempt: jest.fn().mockResolvedValue(1),
    resetFailedLogins: jest.fn(),
    createUser: jest.fn(),
    upsertUser: jest.fn(),
    setPasswordResetToken: jest.fn(),
    getEmailTemplate: jest.fn(),
    getCompanySettings: jest.fn(),
    getActiveEmailProvider: jest.fn(),
    getUserInvitations: jest.fn(),
    getUserInvitationByToken: jest.fn(),
    createUserClaimingInvitation: jest.fn(),
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
      // Stays 400 (never 409): the answer is the same for every kind of account.
      expect(response.body.error).toBe('email_registered');
    });

    it('ignores role, isApproved, isActive and id in the body: a self-registration is an unapproved customer', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);
      (storage.createUser as jest.Mock).mockImplementation(async (u: Record<string, unknown>) => u);

      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validUser, role: 'admin', isApproved: true, isActive: false, id: 'chosen-id' });

      expect(response.status).toBe(201);
      expect(response.body.user).toEqual(
        expect.objectContaining({ role: 'customer', isApproved: false })
      );
      const created = (storage.createUser as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(created).toEqual(
        expect.objectContaining({ role: 'customer', isApproved: false, isActive: true })
      );
      expect(created.id).not.toBe('chosen-id');
    });

    it('answers a validation failure with the error contract', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validUser, email: 'not-an-email', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('validation_failed');
      expect(response.body.details.fieldErrors.email).toBeDefined();
      expect(response.body.details.fieldErrors.password).toBeDefined();
      expect(storage.createUser).not.toHaveBeenCalled();
    });

    it('answers a bad invitation with the invalid_invitation code', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);
      (storage.getUserInvitationByToken as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validUser, inviteToken: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_invitation');
    });

    it('should auto-approve invited users', async () => {
      (storage.getUserByEmail as jest.Mock).mockResolvedValue(null);
      (storage.getUserInvitationByToken as jest.Mock).mockResolvedValue({
        id: 1,
        email: validUser.email,
        role: 'agent',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400000),
        departmentId: 1
      });
      (storage.createUserClaimingInvitation as jest.Mock).mockResolvedValue({
        id: '123',
        ...validUser,
        role: 'agent',
        isApproved: true
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validUser, inviteToken: 'valid-token' });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('You can now log in');
      expect(storage.createUserClaimingInvitation).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'agent', isApproved: true }),
        1
      );
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

      // Identical to a password account's answer: SSO-ness is not revealed.
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Email already registered');
      expect(response.body.error).toBe('email_registered');
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
      expect(response.body.error).toBe('invalid_credentials');
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
      expect(response.body.error).toBe('invalid_credentials');
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
        email: 'test@example.com',
        password: 'stored-hash'
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