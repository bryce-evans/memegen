/** Isolated app stack configuration, shared by Playwright and its database setup. */
export const WEB_PORT = 5174;
export const AI_STUB_PORT = 4102;
export const FEEDBACK_SINK_PORT = 4104;
const API_PORT = 4100;
const STORAGE_PORT = 4101;
const SEARCH_PORT = 4103;

export const E2E_ENV = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/memegen_e2e",
  E2E_MAIN_DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost:5432/memegen",
  E2E_MAIN_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR ?? ".data/storage",
  API_PORT: String(API_PORT),
  STORAGE_PORT: String(STORAGE_PORT),
  WEB_PORT: String(WEB_PORT),
  // Never let caller overrides point the isolated web proxy at another stack.
  API_URL: `http://localhost:${API_PORT}`,
  STORAGE_URL: `http://localhost:${STORAGE_PORT}`,
  STORAGE_PROVIDER: "local",
  LOCAL_STORAGE_DIR: ".data/e2e-storage",
  INTERNAL_TOKEN: "e2e-internal-token",
  // Preserve prod so setup can refuse it; specs otherwise sign in through dev login.
  MODE: process.env.MODE ?? "dev",
  AUTH_MODE: "dev",
  FEEDBACK_PROVIDER: "webhook",
  FEEDBACK_WEBHOOK_URL: `http://127.0.0.1:${FEEDBACK_SINK_PORT}/deliver`,
  OPENAI_BASE_URL: `http://127.0.0.1:${AI_STUB_PORT}/openai/v1`,
  GEMINI_BASE_URL: `http://127.0.0.1:${AI_STUB_PORT}/gemini/v1beta`,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_STUB_PORT}/anthropic/v1`,
  // Real search, with its model and embedding cache shared with dev.
  SEARCH_ENABLED: "true",
  SEARCH_PORT: String(SEARCH_PORT),
  SEARCH_URL: `http://localhost:${SEARCH_PORT}`,
};
