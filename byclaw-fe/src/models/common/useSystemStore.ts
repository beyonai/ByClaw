import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

type State = {
  screenWidth: number;
  isPc?: boolean;
  setScreenWidth: (screenWidth: number) => void;
};

export const useSystemStore = create<State>()(
  devtools(
    persist(
      (set) => ({
        screenWidth: 600,
        isPc: undefined,
        setScreenWidth: (screenWidth: number) =>
          set({
            screenWidth,
            isPc: screenWidth >= 900,
          }),
      }),
      {
        name: 'systemStore',
        partialize: () => ({}),
      }
    )
  )
);
