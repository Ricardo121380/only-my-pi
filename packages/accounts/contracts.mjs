export const CLI_ACCOUNT_ID = "cli-readonly";
export const accountError = (code, status = 400) => Object.assign(new Error(code), { code, status });
