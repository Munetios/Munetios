export function calendarNotificationPermissionGranted(
  notificationApi = globalThis.Notification,
) {
  return Boolean(notificationApi && notificationApi.permission === "granted");
}

export async function requestCalendarNotificationPermission(
  notificationApi = globalThis.Notification,
) {
  if (!notificationApi) return false;
  if (notificationApi.permission === "granted") return true;
  if (notificationApi.permission !== "default") return false;
  try {
    return (await notificationApi.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
