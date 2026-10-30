/** Meldingen in de browser bestaan alleen in de webversie; in de app gaan meldingen via Expo. */
export type WebPushStatus = 'unsupported' | 'needs-home-screen' | 'not-configured' | 'denied' | 'off' | 'on';

export async function webPushStatus(): Promise<WebPushStatus> {
  return 'unsupported';
}
export async function enableWebPush(): Promise<void> {
  throw new Error('Alleen in de webversie.');
}
export async function disableWebPush(): Promise<void> {}
export async function refreshWebPush(): Promise<void> {}
