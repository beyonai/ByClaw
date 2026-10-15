import { IObjectType, SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { getLatestDigitalEmployeeMessage, hasVncActivity, isVncToolMessage } from '@/utils/chatVnc';

const toolCall = (substance: unknown): IMessageListItem =>
  ({ contentType: SSEMessageType.toolCall, content: { substance } } as IMessageListItem);
const commandMessage = (command: string) => toolCall({ title: 'Bash', input: { command } });
const answer = (overrides: Partial<IMessage> = {}): IMessage =>
  ({ fromBeyond: true, sessionId: 'session-a', usage: '2', ...overrides } as IMessage);

describe('isVncToolMessage', () => {
  it.each(['browser', 'mcp__browser__open', 'jarvis_run_flow'])('recognizes the existing %s tools', (title) => {
    expect(isVncToolMessage(toolCall({ title, input: null }))).toBe(true);
  });

  it('recognizes JSON encoded tool substance and input', () => {
    expect(
      isVncToolMessage(
        toolCall(JSON.stringify({ title: 'Bash', input: JSON.stringify({ command: 'bycli tab list' }) }))
      )
    ).toBe(true);
  });

  it.each([undefined, null, {}, { input: null }, { title: null, input: null }, '{invalid'])(
    'ignores malformed tool bodies without throwing (%p)',
    (substance) => {
      expect(isVncToolMessage(toolCall(substance))).toBe(false);
    }
  );

  it('recognizes a command even when the tool title is missing', () => {
    expect(isVncToolMessage(toolCall({ input: { command: 'bycli browser open https://example.test/' } }))).toBe(true);
  });

  it.each([undefined, null, {}])('accepts an absent message (%p)', (message) => {
    expect(isVncToolMessage(message)).toBe(false);
  });

  it('recognizes a jsonBlock command', () => {
    expect(
      isVncToolMessage({
        contentType: SSEMessageType.jsonBlock,
        content: { substance: { json: JSON.stringify({ command: 'bycli browser tabs' }) } },
      })
    ).toBe(true);
  });

  it('accepts a string contentType received from history', () => {
    expect(
      isVncToolMessage({ ...commandMessage('bycli browser tabs'), contentType: '3015' as unknown as SSEMessageType })
    ).toBe(true);
  });

  it.each([null, '{invalid', 'null', '[]'])('ignores malformed jsonBlock data (%p)', (json) => {
    expect(isVncToolMessage({ contentType: SSEMessageType.jsonBlock, content: { substance: { json } } })).toBe(false);
  });

  it('recognizes a tool_call thinking title', () => {
    expect(
      isVncToolMessage({
        contentType: SSEMessageType.thinkStatusTitle,
        objectType: IObjectType.toolCall as 'tool_call',
        content: { substance: { title: 'browser' } },
      })
    ).toBe(true);
  });

  it('does not treat an ordinary thinking title as a tool call', () => {
    expect(
      isVncToolMessage({
        contentType: SSEMessageType.thinkStatusTitle,
        content: { substance: { title: 'browser' } },
      })
    ).toBe(false);
  });

  it('does not treat ordinary answer content as a tool call', () => {
    expect(isVncToolMessage({ contentType: SSEMessageType.text, content: { substance: 'bycli browser open' } })).toBe(
      false
    );
  });

  it('does not open VNC for a browser status probe', () => {
    expect(isVncToolMessage(toolCall({ title: 'browser', input: { operation: 'status' } }))).toBe(false);
  });

  it('does not open VNC for a JSON encoded browser status probe', () => {
    expect(isVncToolMessage(toolCall({ title: 'browser', input: '{"operation":"status"}' }))).toBe(false);
  });

  it.each([{}, { input: null }, { input: '{invalid' }])(
    'does not infer browser activity from a result without valid input (%p)',
    (body) => {
      expect(
        isVncToolMessage(toolCall({ title: 'browser', ...body, output: { success: true }, status: '_DONE_' }))
      ).toBe(false);
    }
  );

  it('recognizes a browser result merged with its navigation input', () => {
    expect(
      isVncToolMessage(
        toolCall({
          title: 'browser',
          input: { operation: 'navigate', url: 'https://example.test/' },
          output: { success: true },
          status: '_DONE_',
        })
      )
    ).toBe(true);
  });

  it('does not open VNC for a browser result merged with its status input', () => {
    expect(
      isVncToolMessage(
        toolCall({ title: 'browser', input: { operation: 'status' }, output: { running: true }, status: '_DONE_' })
      )
    ).toBe(false);
  });

  it('keeps title-only browser calls compatible when no result output exists', () => {
    expect(isVncToolMessage(toolCall({ title: 'browser' }))).toBe(true);
  });

  it.each([
    'bycli browser open https://example.test/',
    '/usr/local/bin/bycli browser open https://example.test/',
    'bycli upload example.txt',
    'env BYCLAW_AGENT_ID="test-agent" bycli browser tabs',
    'env -i -- TEST_MODE=1 /usr/local/bin/bycli browser tabs',
    'TEST_MODE=1 bycli browser tabs',
    'cd /work && RUN=$(cat RUNPATH.txt) && env BYCLAW_AGENT_ID="$DSH_BYCLAW_AGENT_ID" BYCLAW_DSH_AGENT_ID=\'11265157\' bycli browser bygcollect open "https://example.test/" 2>&1 | tail -30',
    'cd /work; bycli browser tabs',
    'echo ready\nbycli browser tabs',
    'echo ready | bycli browser tabs',
    'false || bycli browser tabs',
    '"/opt/tools/bycli" browser tabs',
    'printf "%s" "<<EOF"; bycli browser tabs',
    'bycli browser open "https://example.test/?query=<<"',
    "bycli browser main open https://example.test/; cat <<'EOF'\ntext\nEOF",
    "cat <<'EOF'\nbycli fake\nEOF\nbycli browser main open https://example.test/",
    "cat <<-'EOF'\n\tbycli fake\n\tEOF\nbycli browser main open https://example.test/",
  ])('recognizes the executable in %s', (command) => {
    expect(isVncToolMessage(commandMessage(command))).toBe(true);
  });

  it.each([
    'echo bycli browser open https://example.test/',
    'printf "%s" "bycli browser open https://example.test/"',
    'grep bycli notes.txt',
    'cat bycli',
    'bycli-fake browser open https://example.test/',
    'echo "ready && bycli browser tabs"',
    "printf '%s' 'ready; bycli browser tabs'",
    'echo ready # bycli browser tabs',
    'echo "$(printf bycli)"',
    'env bycli-fake browser tabs',
    'TEST_COMMAND="bycli browser tabs" printf "%s" "$TEST_COMMAND"',
    'echo web-acquirer.mjs',
    'printf "%s" ima.mjs',
    'grep bycli_integration.mjs notes.txt',
    'cat public-discovery.mjs',
    'echo public-collect',
    'node -e "console.log(\'web-acquirer.mjs\')"',
    "cat <<'EOF'\nbycli browser open https://example.test/\nEOF",
    'cat <<EOF\nbycli browser open https://example.test/\nEOF',
    'cat <<-EOF\n\tbycli browser open https://example.test/\n\tEOF',
    "cat <<'EOF'\nnode /work/scripts/web-acquirer.mjs https://example.test/\nEOF",
    '"bycli',
    "'bycli",
    'bycli browser open "https://example.test/',
  ])('ignores command names used as data in %s', (command) => {
    expect(isVncToolMessage(commandMessage(command))).toBe(false);
  });

  it.each(['web-acquirer.mjs', 'ima.mjs', 'bycli_integration.mjs', 'public-discovery.mjs', 'public-collect'])(
    'recognizes an invoked legacy %s script',
    (script) => {
      expect(isVncToolMessage(commandMessage(`node /work/scripts/${script} https://example.test/`))).toBe(true);
    }
  );

  it('recognizes a directly invoked legacy script', () => {
    expect(isVncToolMessage(commandMessage('/work/scripts/public-collect https://example.test/'))).toBe(true);
  });

  it('recognizes public-collect invoked through the collection dispatcher', () => {
    expect(
      isVncToolMessage(commandMessage('node /work/scripts/knowledge-collection.mjs public-collect --session-dir run'))
    ).toBe(true);
  });

  it('does not treat a future public-collect workflow flag as an invoked operation', () => {
    expect(
      isVncToolMessage(commandMessage('node /work/scripts/knowledge-collection.mjs init --workflow public-collect'))
    ).toBe(false);
  });

  it('recognizes reading the bycli skill guide', () => {
    expect(isVncToolMessage(toolCall({ title: 'Read', input: { path: '/work/skills/bycli/SKILL.md' } }))).toBe(true);
  });

  it('ignores unrelated read paths', () => {
    expect(isVncToolMessage(toolCall({ title: 'Read', input: { path: '/work/skills/other/SKILL.md' } }))).toBe(false);
  });
});

describe('hasVncActivity', () => {
  it.each(['thinkList', 'messageList'] as const)('finds tools in the single answer %s', (channel) => {
    expect(hasVncActivity(answer({ [channel]: [commandMessage('bycli browser tabs')] }))).toBe(true);
  });

  it('ignores a user message that contains tool-shaped content', () => {
    expect(hasVncActivity(answer({ fromBeyond: false, messageList: [commandMessage('bycli browser tabs')] }))).toBe(
      false
    );
  });

  it.each([undefined, null, {}, answer()])('returns false when the answer has no browser activity (%p)', (message) => {
    expect(hasVncActivity(message)).toBe(false);
  });
});

describe('getLatestDigitalEmployeeMessage', () => {
  it('uses list order and returns the latest answer without consulting earlier VNC activity', () => {
    const older = answer({ messageList: [commandMessage('bycli browser tabs')], createTime: '2026-10-15T12:00:00Z' });
    const latest = answer({ messageList: [], createTime: '2026-10-15T10:00:00Z' });

    expect(getLatestDigitalEmployeeMessage([older, latest], 'session-a')).toBe(latest);
    expect(hasVncActivity(getLatestDigitalEmployeeMessage([older, latest], 'session-a'))).toBe(false);
  });

  it('excludes messages in other sessions', () => {
    const current = answer();
    const other = answer({ sessionId: 'session-b' });

    expect(getLatestDigitalEmployeeMessage([current, other], 'session-a')).toBe(current);
  });

  it.each(['1', '3', '4', '5'] as const)('skips usage %s even when fromBeyond is set', (usage) => {
    const current = answer();

    expect(getLatestDigitalEmployeeMessage([current, answer({ usage })], 'session-a')).toBe(current);
  });

  it.each([1, 3, 4, 5])('skips numeric API usage %s even when fromBeyond is set', (usage) => {
    const current = answer();

    expect(getLatestDigitalEmployeeMessage([current, answer({ usage: usage as any })], 'session-a')).toBe(current);
  });

  it('finds VNC activity in a historical API answer with numeric usage 2', () => {
    const history = answer({
      usage: 2 as any,
      thinkList: [
        toolCall({
          title: 'Bash',
          input: JSON.stringify({ command: 'bycli browser bygcollect open "https://example.test/"' }),
        }),
      ],
    });
    const latest = getLatestDigitalEmployeeMessage([history], 'session-a');

    expect(latest).toBe(history);
    expect(hasVncActivity(latest)).toBe(true);
  });

  it('accepts an answer whose usage has not arrived yet', () => {
    const pending = answer({ usage: undefined });

    expect(getLatestDigitalEmployeeMessage([answer(), pending], 'session-a')).toBe(pending);
  });

  it('ignores newer user messages', () => {
    const current = answer();

    expect(getLatestDigitalEmployeeMessage([current, answer({ fromBeyond: false })], 'session-a')).toBe(current);
  });

  it('returns the latest answer without a session filter when sessionId is absent', () => {
    const latest = answer({ sessionId: 'session-b' });

    expect(getLatestDigitalEmployeeMessage([answer(), latest])).toBe(latest);
  });

  it('returns undefined when the current session has no eligible answer', () => {
    expect(getLatestDigitalEmployeeMessage([answer({ sessionId: 'session-b' })], 'session-a')).toBeUndefined();
    expect(getLatestDigitalEmployeeMessage([], 'session-a')).toBeUndefined();
  });
});
