/** Subscribe while visible. Reconnect with backoff; reconcile after missed events. */
export function chatNotifications(path: string, refresh: () => void) {
 let socket: WebSocket | undefined;
 let timer: ReturnType<typeof setTimeout> | undefined;
 let stopped = false;
 let delay = 1000;
 function connect() {
  if (stopped || document.visibilityState !== 'visible') return;
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(url);
  socket.onopen = () => { delay = 1000; refresh(); };
  socket.onmessage = event => { if (event.data === 'changed') refresh(); };
  socket.onerror = () => socket?.close();
  socket.onclose = () => {
   if (stopped || document.visibilityState !== 'visible') return;
   timer = setTimeout(connect, delay + Math.random() * 1000);
   delay = Math.min(60000, delay * 2);
  };
 }
 function visibility() {
  clearTimeout(timer);
  if (socket) { socket.onclose = null; socket.close(); socket = undefined; }
  if (document.visibilityState === 'visible') { refresh(); connect(); }
 }
 document.addEventListener('visibilitychange', visibility);
 connect();
 // Recovery for lost notifications and periodic reauthentication, not rapid polling.
 const recovery = setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
 }, 300000);
 const reauthenticate = setInterval(visibility, 1800000);
 return () => {
  stopped = true; clearTimeout(timer); clearInterval(recovery); clearInterval(reauthenticate);
  document.removeEventListener('visibilitychange', visibility);
  if (socket) { socket.onclose = null; socket.close(); }
 };
}
