const tokenByModelId = new Map<string, string>();

function normalizeModelId(modelId: string): string {
    return modelId.trim();
}

export function rememberAimodelAuthToken(params: { modelId: string; token: string | null }): void {
    const modelId = normalizeModelId(params.modelId);
    if (!modelId) {
        return;
    }
    const token = params.token?.trim() ?? "";
    if (token) {
        tokenByModelId.set(modelId, token);
    } else {
        tokenByModelId.delete(modelId);
    }
}

export function getCachedAimodelAuthToken(modelId: string): string | null {
    return tokenByModelId.get(normalizeModelId(modelId)) ?? null;
}

export function resetAimodelAuthTokenCacheForTests(): void {
    tokenByModelId.clear();
}
