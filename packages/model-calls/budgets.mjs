// Shared numeric contract. Browser consumers must not load the ledger or Node APIs.
export const MODEL_BUDGET = Object.freeze({ requests: 4, concurrency: 1, maxInputBytes: 8192, maxOutputBytes: 8192, inputBytes: 32768, outputBytes: 32768, timeoutMs: 10000 });
export const MODEL_BUDGET_LIMITS = Object.freeze({ requests: 32, concurrency: 4, maxInputBytes: 32768, maxOutputBytes: 65536, inputBytes: 1048576, outputBytes: 2097152, timeoutMs: 60000 });
export const IMAGE_BUDGET = Object.freeze({ ...MODEL_BUDGET, maxOutputBytes: 2097152, outputBytes: 8388608, maxImagesPerRequest: 1, images: 4, maxStorageBytes: 1048576, storageBytes: 4194304 });
export const IMAGE_BUDGET_LIMITS = Object.freeze({ ...MODEL_BUDGET_LIMITS, maxOutputBytes: 16777216, outputBytes: 67108864, maxImagesPerRequest: 4, images: 32, maxStorageBytes: 10485760, storageBytes: 67108864 });
