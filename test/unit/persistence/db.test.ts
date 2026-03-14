const mockQuery = jest.fn();
const mockOn = jest.fn();
const mockEnd = jest.fn();
const mockPoolInstance = { query: mockQuery, on: mockOn, end: mockEnd };

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPoolInstance),
}));

jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { Pool } from 'pg';
import { connectDb, getPool, disconnectDb } from '../../../src/persistence/db';
import { logger } from '../../../src/observability/logger';

describe('db', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  });

  afterEach(async () => {
    try {
      await disconnectDb();
    } catch {
      // pool may already be null
    }
  });

  it('connectDb creates pool and executes SELECT 1', async () => {
    const pool = await connectDb('postgres://test');

    expect(Pool).toHaveBeenCalledWith({
      connectionString: 'postgres://test',
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
    expect(pool).toBe(mockPoolInstance);
  });

  it('connectDb logs error and rethrows if connection fails', async () => {
    const error = new Error('connection refused');
    mockQuery.mockRejectedValueOnce(error);

    await expect(connectDb('postgres://bad')).rejects.toThrow('connection refused');
    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      'Failed to connect to PostgreSQL',
    );
    expect(() => getPool()).toThrow('Database pool not initialized');
  });

  it('getPool returns the pool when initialized', async () => {
    const pool = await connectDb('postgres://test');
    expect(getPool()).toBe(pool);
  });

  it('getPool throws if connectDb was not called', () => {
    expect(() => getPool()).toThrow('Database pool not initialized');
  });

  it('disconnectDb calls pool.end() and resets to null', async () => {
    await connectDb('postgres://test');
    await disconnectDb();

    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(() => getPool()).toThrow('Database pool not initialized');
  });

  it('disconnectDb does not fail if there is no pool', async () => {
    await expect(disconnectDb()).resolves.toBeUndefined();
  });

  it('pool params are correct', async () => {
    await connectDb('postgres://verify');
    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://verify',
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
    );
  });

  it('registers pool.on("error") listener', async () => {
    await connectDb('postgres://test');

    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));

    const errorCallback = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === 'error',
    )![1] as (err: Error) => void;
    const testErr = new Error('idle error');
    errorCallback(testErr);

    expect(logger.error).toHaveBeenCalledWith(
      { err: testErr },
      'Unexpected error on idle PostgreSQL client',
    );
  });
});
