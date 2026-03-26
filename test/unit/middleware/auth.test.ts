import { authMiddleware } from '../../../src/api/middleware/auth';

describe('authMiddleware', () => {
  const mockReply = () => {
    const reply: Record<string, unknown> = {};
    reply.status = jest.fn().mockReturnValue(reply);
    reply.send = jest.fn().mockReturnValue(reply);
    return reply as unknown as { status: jest.Mock; send: jest.Mock };
  };

  it('should return 401 when jwtVerify throws', async () => {
    const request = {
      jwtVerify: jest.fn().mockRejectedValue(new Error('jwt expired')),
    } as unknown as Parameters<typeof authMiddleware>[0];
    const reply = mockReply();

    await authMiddleware(request, reply as unknown as Parameters<typeof authMiddleware>[1]);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  it('should include error message in 401 response', async () => {
    const request = {
      jwtVerify: jest.fn().mockRejectedValue(new Error('invalid signature')),
    } as unknown as Parameters<typeof authMiddleware>[0];
    const reply = mockReply();

    await authMiddleware(request, reply as unknown as Parameters<typeof authMiddleware>[1]);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('invalid signature'),
      }),
    );
  });

  it('should not call reply when jwtVerify succeeds', async () => {
    const request = {
      jwtVerify: jest.fn().mockResolvedValue({ sub: 'test-user' }),
    } as unknown as Parameters<typeof authMiddleware>[0];
    const reply = mockReply();

    await authMiddleware(request, reply as unknown as Parameters<typeof authMiddleware>[1]);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('should handle non-Error thrown values', async () => {
    const request = {
      jwtVerify: jest.fn().mockRejectedValue('string error'),
    } as unknown as Parameters<typeof authMiddleware>[0];
    const reply = mockReply();

    await authMiddleware(request, reply as unknown as Parameters<typeof authMiddleware>[1]);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'UNAUTHORIZED',
        message: expect.stringContaining('Invalid token'),
      }),
    );
  });
});
