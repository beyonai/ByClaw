export type AppNotification = {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
};

export function hasNativeDesktopNotifications(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      window.byclawDesktop?.capabilities?.includes('notifications.native') &&
      window.byclawDesktop.notifications?.show
  );
}

export async function showAppNotification(input: AppNotification): Promise<boolean> {
  if (hasNativeDesktopNotifications()) {
    await window.byclawDesktop!.notifications!.show(input);
    return true;
  }
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return false;
  if (window.Notification.permission !== 'granted') return false;
  try {
    const notification = new window.Notification(input.title, { body: input.body, tag: input.tag });
    notification.onclick = () => {
      window.focus();
      notification.close();
      if (input.url) window.location.assign(input.url);
    };
    return true;
  } catch {
    return false;
  }
}

export function isNativeDesktopNotifications(): boolean {
  return hasNativeDesktopNotifications();
}
