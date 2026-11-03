export const modelCallError = (code, status = 400) => Object.assign(new Error(code), { code, status });
