import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type VoicePreferences = { autoPlay: boolean; autoTranscribe: boolean };
const defaults: VoicePreferences = { autoPlay: true, autoTranscribe: true };

const useStore = create<{
  users: Record<string, VoicePreferences>;
  update: (userId: string, patch: Partial<VoicePreferences>) => void;
}>()(
  persist(
    (set) => ({
      users: {},
      update: (userId, patch) =>
        set((state) => ({ users: { ...state.users, [userId]: { ...defaults, ...state.users[userId], ...patch } } })),
    }),
    { name: 'byclaw-voice-preferences', partialize: (state) => ({ users: state.users }) }
  )
);

/** Browser preferences are isolated by account, like other local UI preferences. */
export default function useVoicePreferences(userId?: string | number) {
  const key = userId === undefined || userId === null ? '' : String(userId);
  const preferences = useStore((state) => state.users[key] || defaults);
  const update = useStore((state) => state.update);
  return { ...preferences, update: (patch: Partial<VoicePreferences>) => key && update(key, patch) };
}
