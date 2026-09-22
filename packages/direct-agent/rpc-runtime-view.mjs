// Pi 0.85.1's public RPC driver binds after a replacement both through the
// runtime callback and through its command handler. Its public AgentSession
// bindExtensions emits session_start on each call. Scope binding idempotence to
// this transport view, without patching Pi or changing the actual session.
export function createRpcRuntimeView(runtime) {
  const views = new WeakMap();
  const sessionView = (session) => {
    if (views.has(session)) return views.get(session);
    let binding;
    const bindOnce = (options) => binding ??= Promise.resolve().then(() => session.bindExtensions(options));
    const view = new Proxy(session, {
      get(target, key) {
        if (key === "bindExtensions") return bindOnce;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    views.set(session, view);
    return view;
  };
  return new Proxy(runtime, {
    get(target, key) {
      if (key === "session") return sessionView(target.session);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
