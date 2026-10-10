export const isMcpOAuthActive = (status) => ["starting", "waiting", "refreshing", "cancelling"].includes(status);
export const isMcpOAuthStored = (status) => ["stored", "stored_sync_failed"].includes(status);
export const isMcpOAuthBlocked = (flow) => flow?.status === "publication_unconfirmed" || flow?.kind === "refresh" && !isMcpOAuthStored(flow.status);
