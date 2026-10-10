export const isMcpOAuthActive = (status) => ["starting", "waiting", "refreshing", "cancelling"].includes(status);
export const isMcpOAuthStored = (status) => ["stored", "stored_sync_failed"].includes(status);
