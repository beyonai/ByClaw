import { IObjectType, SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { isSameSessionId, type SessionIdInput } from '@/utils/sessionId';

const legacyScripts = new Set([
  'web-acquirer.mjs',
  'ima.mjs',
  'bycli_integration.mjs',
  'public-discovery.mjs',
  'public-collect',
  'public-collect.mjs',
]);

const parseObject = (value: unknown): Record<string, unknown> | undefined => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const basename = (value: string) => value.slice(value.lastIndexOf('/') + 1);
const isAssignment = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);

// Keep substitutions opaque: their spaces/operators must not turn assignment values into commands.
const skipSubstitution = (command: string, start: number) => {
  let depth = 1;
  let quote = '';
  for (let index = start + 2; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      index += 1;
    } else if (quote) {
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (!depth) return index;
    }
  }
  return command.length - 1;
};

type Heredoc = { delimiter: string; stripTabs: boolean };

const readHeredoc = (command: string, start: number): (Heredoc & { end: number }) | undefined => {
  let index = start + 2;
  if (command[index] === '<') return undefined;
  const stripTabs = command[index] === '-';
  if (stripTabs) index += 1;
  while (command[index] === ' ' || command[index] === '\t') index += 1;
  let delimiter = '';
  let quote = '';
  let started = false;
  for (; index < command.length && command[index] !== '\n'; index += 1) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      index += 1;
      if (index >= command.length || command[index] === '\n') return undefined;
      delimiter += command[index];
      started = true;
    } else if (quote) {
      if (char === quote) quote = '';
      else delimiter += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/[\s;&|<>]/.test(char)) {
      break;
    } else {
      delimiter += char;
      started = true;
    }
  }
  return started && !quote ? { delimiter, stripTabs, end: index } : undefined;
};

const skipHeredocBodies = (command: string, start: number, heredocs: Heredoc[]): number | undefined => {
  let index = start;
  for (const { delimiter, stripTabs } of heredocs) {
    let found = false;
    while (index <= command.length) {
      const newline = command.indexOf('\n', index);
      const end = newline < 0 ? command.length : newline;
      const line = command.slice(index, end);
      index = end + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
        found = true;
        break;
      }
      if (newline < 0) break;
    }
    if (!found) return undefined;
  }
  return index;
};

// This reads only shell words and command boundaries; it never expands or executes shell input.
const splitShellCommands = (command: string): string[][] => {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let started = false;
  let quote = '';
  const heredocs: Heredoc[] = [];
  const flushWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const flushCommand = () => {
    flushWord();
    if (words.length) commands.push(words);
    words = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      index += 1;
      if (command[index] !== '\n') {
        word += command[index] || '';
        started = true;
      }
    } else if (char === '$' && command[index + 1] === '(' && quote !== "'") {
      const end = skipSubstitution(command, index);
      word += command.slice(index, end + 1);
      started = true;
      index = end;
    } else if (quote) {
      if (char === quote) quote = '';
      else word += char;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
      started = true;
    } else if (char === '#' && !started) {
      const end = command.indexOf('\n', index);
      index = end < 0 ? command.length : end - 1;
    } else if (char === '<' && command[index + 1] === '<') {
      const heredoc = readHeredoc(command, index);
      if (!heredoc) return [];
      // A numeric word immediately before redirection is a file descriptor, not the command name.
      if (started && /^\d+$/.test(word)) {
        word = '';
        started = false;
      }
      flushWord();
      heredocs.push(heredoc);
      index = heredoc.end - 1;
    } else if (char === '\n') {
      flushCommand();
      if (heredocs.length) {
        const next = skipHeredocBodies(command, index + 1, heredocs);
        if (next === undefined) return [];
        index = next - 1;
        heredocs.length = 0;
      }
    } else if (';|'.includes(char) || (char === '&' && !/[<>]/.test(command[index - 1] || ''))) {
      flushCommand();
    } else if (/\s/.test(char)) {
      flushWord();
    } else {
      word += char;
      started = true;
    }
  }
  if (quote || heredocs.length) return [];
  flushCommand();
  return commands;
};

const isBrowserCommand = (words: string[]): boolean => {
  let index = 0;
  while (index < words.length && isAssignment(words[index])) index += 1;
  if (basename(words[index] || '') === 'env') {
    index += 1;
    while (index < words.length) {
      const word = words[index];
      if (isAssignment(word) || word === '--') {
        index += 1;
      } else if (['-u', '--unset', '-C', '--chdir'].includes(word)) {
        index += 2;
      } else if (word.startsWith('-')) {
        index += 1;
      } else {
        break;
      }
    }
  }
  const executable = basename(words[index] || '');
  if (executable === 'bycli' || legacyScripts.has(executable)) return true;
  if (executable !== 'node' && executable !== 'nodejs') return false;
  index += 1;
  while (index < words.length && words[index].startsWith('-')) {
    const option = words[index];
    // Eval/print text is data, even if it mentions one of the legacy script names.
    if (/^-(?:[ep]|-eval|-print)(?:=|$)/.test(option)) return false;
    index += ['-r', '--require', '--import', '--loader', '--experimental-loader'].includes(option) ? 2 : 1;
  }
  const script = basename(words[index] || '');
  return legacyScripts.has(script) || (script === 'knowledge-collection.mjs' && words[index + 1] === 'public-collect');
};

const hasBrowserInput = (input: Record<string, unknown> | undefined) => {
  if (typeof input?.command === 'string' && splitShellCommands(input.command).some(isBrowserCommand)) return true;
  return typeof input?.path === 'string' && input.path.toLowerCase().includes('/bycli/skill.md');
};

const isBrowserTool = (title: unknown) =>
  typeof title === 'string' && (title.includes('jarvis_run_flow') || title.includes('browser'));

export function isVncToolMessage(message?: Partial<IMessageListItem> | null): boolean {
  const substance = parseObject(message?.content?.substance);
  switch (String(message?.contentType)) {
    case String(SSEMessageType.toolCall): {
      const input = parseObject(substance?.input);
      if (isBrowserTool(substance?.title)) {
        if (!input && substance && 'output' in substance) return false;
        return input?.operation !== 'status';
      }
      return hasBrowserInput(input);
    }
    case String(SSEMessageType.jsonBlock):
      return hasBrowserInput(parseObject(substance?.json));
    case String(SSEMessageType.thinkStatusTitle):
      return message?.objectType === IObjectType.toolCall && isBrowserTool(substance?.title);
  }
  return false;
}

export function hasVncActivity(message?: Partial<IMessage> | null): boolean {
  return (
    message?.fromBeyond === true &&
    ((message.thinkList || []).some(isVncToolMessage) || (message.messageList || []).some(isVncToolMessage))
  );
}

export function getLatestDigitalEmployeeMessage(
  messages: IMessage[],
  sessionId?: SessionIdInput
): IMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.fromBeyond &&
      (sessionId === undefined || isSameSessionId(message.sessionId, sessionId)) &&
      (message.usage === undefined || String(message.usage) === '2')
    ) {
      return message;
    }
  }
  return undefined;
}
