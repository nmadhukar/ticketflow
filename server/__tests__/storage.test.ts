import { DatabaseStorage } from '../storage';
import { db } from '../db';
import { users, tasks, teams, comments } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Mock database
jest.mock('../db', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }
}));

describe('DatabaseStorage', () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    storage = new DatabaseStorage();
    jest.clearAllMocks();
  });

  describe('User Operations', () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'user',
      isActive: true,
      isApproved: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    it('should get user by id', async () => {
      const selectMock = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([mockUser])
      };
      (db.select as jest.Mock).mockReturnValue(selectMock);

      const result = await storage.getUser('123');

      expect(result).toEqual(mockUser);
      expect(db.select).toHaveBeenCalled();
    });

    it('should get user by email', async () => {
      const selectMock = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([mockUser])
      };
      (db.select as jest.Mock).mockReturnValue(selectMock);

      const result = await storage.getUserByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(db.select).toHaveBeenCalled();
    });

    it('should create a new user', async () => {
      const insertMock = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockUser])
      };
      (db.insert as jest.Mock).mockReturnValue(insertMock);

      const newUser = {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'hashedpassword',
        role: 'user' as const
      };

      const result = await storage.createUser(newUser);

      expect(result).toEqual(mockUser);
      expect(db.insert).toHaveBeenCalledWith(users);
    });

    it('should update user', async () => {
      const updateMock = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockUser])
      };
      (db.update as jest.Mock).mockReturnValue(updateMock);

      const updates = { firstName: 'Updated' };
      const result = await storage.updateUser('123', updates);

      expect(result).toEqual(mockUser);
      expect(db.update).toHaveBeenCalledWith(users);
    });
  });

  describe('Task Operations', () => {
    const mockTask = {
      id: 1,
      ticketNumber: 'TKT-2024-0001',
      title: 'Test Task',
      description: 'Test Description',
      status: 'open',
      priority: 'medium',
      severity: 'normal',
      createdBy: '123',
      createdAt: new Date()
    };

    it('should create a task', async () => {
      const insertMock = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockTask])
      };
      (db.insert as jest.Mock).mockReturnValue(insertMock);

      const newTask = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'open' as const,
        priority: 'medium' as const,
        severity: 'normal' as const,
        createdBy: '123'
      };

      const result = await storage.createTask(newTask);

      expect(result).toEqual(mockTask);
      expect(db.insert).toHaveBeenCalledWith(tasks);
    });

    it('should get tasks with filters', async () => {
      const selectMock = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([{ task: mockTask }])
      };
      (db.select as jest.Mock).mockReturnValue(selectMock);

      const result = await storage.getTasks({ status: 'open' });

      expect(result).toEqual([mockTask]);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('Team Operations', () => {
    const mockTeam = {
      id: 1,
      name: 'Test Team',
      description: 'Test Description',
      createdBy: '123',
      createdAt: new Date()
    };

    it('should create a team', async () => {
      const insertMock = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockTeam])
      };
      (db.insert as jest.Mock).mockReturnValue(insertMock);

      const newTeam = {
        name: 'Test Team',
        description: 'Test Description',
        createdBy: '123'
      };

      const result = await storage.createTeam(newTeam);

      expect(result).toEqual(mockTeam);
      expect(db.insert).toHaveBeenCalledWith(teams);
    });

    it('should get teams for a user', async () => {
      const selectMock = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ team: mockTeam }])
      };
      (db.select as jest.Mock).mockReturnValue(selectMock);

      const result = await storage.getUserTeams('123');

      expect(result).toEqual([mockTeam]);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('Comment Operations', () => {
    const mockComment = {
      id: 1,
      taskId: 1,
      userId: '123',
      content: 'Test comment',
      createdAt: new Date()
    };

    it('should add a comment', async () => {
      const insertMock = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockComment])
      };
      (db.insert as jest.Mock).mockReturnValue(insertMock);

      const newComment = {
        taskId: 1,
        userId: '123',
        content: 'Test comment'
      };

      const result = await storage.addComment(newComment);

      expect(result).toEqual(mockComment);
      expect(db.insert).toHaveBeenCalledWith(comments);
    });

    it('should get task comments', async () => {
      const selectMock = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          { comment: mockComment, user: { firstName: 'Test', lastName: 'User' } }
        ])
      };
      (db.select as jest.Mock).mockReturnValue(selectMock);

      const result = await storage.getTaskComments(1);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 1);
      expect(db.select).toHaveBeenCalled();
    });
  });
});