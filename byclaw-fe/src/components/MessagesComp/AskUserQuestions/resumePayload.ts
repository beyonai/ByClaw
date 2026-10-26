type Question = {
  id?: string;
};

type SubmittedAnswer = {
  selectedOptions: string[];
  otherSelected: boolean;
  otherText: string;
};

export function isDshInteractionResume(
  sourceAgentType: string | undefined,
  interactionId: string | undefined,
  parentRunId: string | undefined
): boolean {
  return sourceAgentType?.startsWith('BYCLAW_DSH') === true || Boolean(interactionId && !parentRunId);
}

/** Build the fields consumed directly by BYCLAW_DSH ResumeCommand. */
export function buildDshInteractionResumePayload(
  interactionId: string | undefined,
  answers: SubmittedAnswer[],
  questions: Question[]
): Record<string, unknown> {
  if (!interactionId) return {};

  return {
    // Keep the flat field for old/plain Resume parsers and operational tracing.
    interaction_id: interactionId,
    dshInteraction: {
      source: 'DSH',
      schemaVersion: 1,
      interactionId,
      outcome: 'answered',
      answers: questions.map((question, index) => {
        const answer = answers[index];
        return {
          id: question.id || `${index + 1}`,
          selected: answer?.selectedOptions || [],
          ...(answer?.otherSelected && answer.otherText ? { custom: answer.otherText } : {}),
        };
      }),
    },
  };
}

/** Prefer routed metadata, but retain the protocol-level id embedded in the 3014 card. */
export function resolveDshInteractionId(
  metadataInteractionId: unknown,
  cardInteractionId: unknown
): string | undefined {
  for (const value of [metadataInteractionId, cardInteractionId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function resolveDshResumeRoute<T extends { parentRunId?: string; interactionId?: string }>(
  metadataRoute: T,
  cardInteractionId: unknown
): T {
  return {
    ...metadataRoute,
    interactionId: resolveDshInteractionId(metadataRoute.interactionId, cardInteractionId),
  };
}
