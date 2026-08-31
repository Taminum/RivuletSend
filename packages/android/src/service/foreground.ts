import notifee, {AndroidImportance} from '@notifee/react-native';

// A foreground service keeps the app (and its WebRTC transfer) alive while it's
// backgrounded or the screen is off — without it Android may suspend the JS.
// Every call is best-effort: if the service can't start, the transfer still runs
// (it just isn't protected from being backgrounded), so failures are swallowed.

let registered = false;
let channelId: string | null = null;

// Register the (never-resolving) service task as early as importing this module.
try {
  notifee.registerForegroundService(() => new Promise(() => {}));
  registered = true;
} catch {
  /* re-registration or unsupported — ignore */
}

async function ensureSetup(): Promise<void> {
  if (!registered) {
    try {
      notifee.registerForegroundService(() => new Promise(() => {}));
      registered = true;
    } catch {}
  }
  try {
    await notifee.requestPermission();
  } catch {}
  if (!channelId) {
    channelId = await notifee.createChannel({
      id: 'transfers',
      name: 'Transfers',
      importance: AndroidImportance.LOW,
    });
  }
}

export async function startTransferService(body: string): Promise<void> {
  try {
    await ensureSetup();
    await notifee.displayNotification({
      id: 'transfer',
      title: 'OwlSend',
      body,
      android: {
        channelId: channelId!,
        asForegroundService: true,
        ongoing: true,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.LOW,
      },
    });
  } catch {}
}

export async function updateTransferService(body: string): Promise<void> {
  if (!channelId) return;
  try {
    await notifee.displayNotification({
      id: 'transfer',
      title: 'OwlSend',
      body,
      android: {
        channelId,
        asForegroundService: true,
        ongoing: true,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.LOW,
      },
    });
  } catch {}
}

export async function stopTransferService(): Promise<void> {
  try {
    await notifee.stopForegroundService();
  } catch {}
  try {
    await notifee.cancelNotification('transfer');
  } catch {}
}
