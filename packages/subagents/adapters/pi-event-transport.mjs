/**
 * Session-scoped adapter over Pi's public extension event bus. It owns only
 * subscriptions created through this instance and never starts a server.
 */
export function createPiEventTransport(pi, { timeoutMs = 120_000, scheduler } = {}) {
  if (typeof pi?.events?.on !== "function" || typeof pi?.events?.emit !== "function") throw new TypeError("Pi event transport requires pi.events.on/emit");
  const timers = scheduler ?? { setTimeout, clearTimeout };
  const subscriptions = new Set();
  let disposed = false;
  return Object.freeze({
    request(envelope, { replyPrefix } = {}) {
      if (disposed) return Promise.reject(Object.assign(new Error("Pi event transport is disposed"), { code: "PI_EVENT_TRANSPORT_DISPOSED" }));
      if (typeof replyPrefix !== "string" || !replyPrefix) throw new TypeError("request requires a replyPrefix");
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const replyEvent = `${replyPrefix}${envelope.requestId}`;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          timers.clearTimeout(timer);
          unsubscribe();
          callback();
        };
        const unsubscribe = pi.events.on(replyEvent, (reply) => finish(() => resolve(reply)));
        subscriptions.add(unsubscribe);
        timer = timers.setTimeout(() => finish(() => reject(Object.assign(new Error("Pi event reply timed out"), { code: "PI_EVENT_REPLY_TIMEOUT" }))), timeoutMs);
        timer?.unref?.();
        pi.events.emit(envelope.eventName, envelope.payload ?? envelope);
      });
    },
    subscribe(eventName, handler) {
      if (disposed) throw Object.assign(new Error("Pi event transport is disposed"), { code: "PI_EVENT_TRANSPORT_DISPOSED" });
      const raw = pi.events.on(eventName, handler);
      const unsubscribe = () => {
        subscriptions.delete(unsubscribe);
        raw?.();
      };
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    emit(eventName, value) {
      if (disposed) throw Object.assign(new Error("Pi event transport is disposed"), { code: "PI_EVENT_TRANSPORT_DISPOSED" });
      pi.events.emit(eventName, value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of [...subscriptions]) unsubscribe();
      subscriptions.clear();
    },
  });
}
