/** Deep link / PASSWORD_RECOVERY → SessionContext yönlendirmesi (AuthEmailLinkListener). */
let notifyRecovery: ((pending: boolean) => void) | null = null;

export function registerPasswordRecoveryHandler(handler: (pending: boolean) => void): () => void {
  notifyRecovery = handler;
  return () => {
    if (notifyRecovery === handler) notifyRecovery = null;
  };
}

export function requestPasswordRecoveryScreen(): void {
  notifyRecovery?.(true);
}
