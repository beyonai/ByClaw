export const getHistoryState = <T>(key: string, defaultValue: T): T => {
  if (typeof window !== 'undefined' && window.history.state && window.history.state[key]) {
    return window.history.state[key];
  }
  return defaultValue;
};
