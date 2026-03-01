import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const IS_ANDROID = Capacitor.getPlatform() === 'android';

export async function initLocalNotifications(): Promise<boolean> {
  console.log('[LocalNotif] initLocalNotifications — platform:', Capacitor.getPlatform());
  if (!IS_ANDROID) { console.log('[LocalNotif] not Android, skipping'); return false; }
  try {
    const result = await LocalNotifications.requestPermissions();
    console.log('[LocalNotif] requestPermissions result:', JSON.stringify(result));

    // Bring the app to the foreground when a notification is tapped
    LocalNotifications.addListener('localNotificationActionPerformed', () => {
      // Capacitor routes the intent back to the WebView; the app opens automatically.
      // This listener ensures the event is consumed so the OS doesn't drop it.
      console.log('[LocalNotif] notification tapped — app should be foreground');
    });

    return result.display === 'granted';
  } catch (e) { console.warn('[LocalNotif] requestPermissions error:', e); return false; }
}

// Debounce bursts into one notification per ID
const timers: Record<number, ReturnType<typeof setTimeout>> = {};

export function fireNotification(id: number, title: string, body: string): void {
  console.log('[LocalNotif] fireNotification called — id:', id, 'IS_ANDROID:', IS_ANDROID, 'body:', body);
  if (!IS_ANDROID) return;
  if (timers[id]) clearTimeout(timers[id]);
  timers[id] = setTimeout(async () => {
    try {
      console.log('[LocalNotif] scheduling notification id:', id);
      await LocalNotifications.schedule({
        notifications: [{ id, title, body, smallIcon: 'ic_notification' }],
      });
      console.log('[LocalNotif] scheduled OK id:', id);
    } catch (e) { console.warn('[LocalNotif] schedule error:', e); }
  }, 2000);
}
