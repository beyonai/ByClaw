export function resolveAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
    const trimmed = sessionKey?.trim();
    if (!trimmed) {
        return undefined;
    }
    const match = /^agent:([^:]+):/i.exec(trimmed);
    return match?.[1]?.trim();
}
