/**
 * The two production servers of the E2E run (see playwright.config.ts): the main one, and one
 * whose daily LLM budget is 0, for the "AI is busy" flows. Each has its own throwaway database.
 */
export const MAIN_PORT = 3100;
export const BUSY_PORT = 3101;
export const BUSY_URL = `http://localhost:${BUSY_PORT}`;
