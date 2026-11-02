import { expect, it, vi } from 'vitest';
import { CommandContext } from '../src/infrastructure/persistence/command-context.js';
import { groupSettings } from '../src/infrastructure/persistence/member-writer.js';
import { command } from './fixtures.js';

it.each([50, 51])('group renaming enforces the same 50-character limit: %s', async (length) => {
  const query = vi.fn(async () => []);
  const name = '组'.repeat(length);
  const context = new CommandContext(
    { query },
    command({ operation: 'UPDATE_SETTINGS', payload: { sessionName: name } }),
  );
  vi.spyOn(context, 'requireRole').mockResolvedValue(undefined);

  if (length === 50) {
    await expect(groupSettings(context)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET session_name=$1'),
      [name, context.command.sessionId, context.command.enterpriseId],
    );
  } else {
    await expect(groupSettings(context)).rejects.toThrow('INVALID_SESSION_NAME');
    expect(query).not.toHaveBeenCalled();
  }
});
