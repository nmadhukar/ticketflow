import { DatabaseStorage } from '../storage';
import { db } from '../storage/db';
import { users, teams } from '@shared/schema';

// Mock database
jest.mock('../storage/db', () => ({
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
});
