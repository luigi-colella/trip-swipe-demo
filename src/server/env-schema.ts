import { z } from "zod";

/**
 * Server-side environment, validated once at startup.
 * The OpenRouter key is only required when LLM_MODE=live.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_PATH: z.string().default("data/app.db"),

    LLM_MODE: z.enum(["fake", "live"]).default("fake"),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().default("openrouter/free"),

    LANGSMITH_TRACING: z.enum(["true", "false"]).default("false"),
    LANGSMITH_API_KEY: z.string().optional(),
    // EU workspaces need https://eu.api.smith.langchain.com; the SDK defaults to the US API.
    LANGSMITH_ENDPOINT: z.url().optional(),
    // Agent address the traces are sent to (as shown in the LangSmith UI). Same rules as the SDK.
    LANGSMITH_AGENT_ID: z
      .string()
      .regex(/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/, "lowercase letters, digits and hyphens")
      .optional(),
    LANGSMITH_AGENT_ENVIRONMENT: z
      .string()
      .toLowerCase()
      .pipe(z.enum(["local", "development", "staging", "production"]))
      .optional(),
    // Legacy destination; the SDK refuses to trace when it is set together with an agent address.
    LANGSMITH_PROJECT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === "live" && !env.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENROUTER_API_KEY"],
        message: "required when LLM_MODE=live",
      });
    }
    // LangChain reads the LANGSMITH_* variables from process.env on its own; fail fast here
    // instead of silently dropping traces.
    if (env.LANGSMITH_TRACING === "true" && !env.LANGSMITH_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["LANGSMITH_API_KEY"],
        message: "required when LANGSMITH_TRACING=true",
      });
    }
    if (!env.LANGSMITH_AGENT_ID !== !env.LANGSMITH_AGENT_ENVIRONMENT) {
      ctx.addIssue({
        code: "custom",
        path: [env.LANGSMITH_AGENT_ID ? "LANGSMITH_AGENT_ENVIRONMENT" : "LANGSMITH_AGENT_ID"],
        message: "LANGSMITH_AGENT_ID and LANGSMITH_AGENT_ENVIRONMENT must be set together",
      });
    }
    if (env.LANGSMITH_AGENT_ID && env.LANGSMITH_PROJECT) {
      ctx.addIssue({
        code: "custom",
        path: ["LANGSMITH_PROJECT"],
        message: "remove it: traces go to the LANGSMITH_AGENT_* address, not to a project",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // `KEY=` lines in .env files mean "not set" (as for the LangSmith SDK).
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = EnvSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
