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
    OPENROUTER_MODEL: z.string().default("openai/gpt-oss-20b:free"),

    LANGSMITH_TRACING: z.enum(["true", "false"]).default("false"),
    LANGSMITH_API_KEY: z.string().optional(),
    LANGSMITH_PROJECT: z.string().default("travel-swipe"),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === "live" && !env.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENROUTER_API_KEY"],
        message: "required when LLM_MODE=live",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
