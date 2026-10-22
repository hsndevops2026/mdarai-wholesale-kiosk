import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Secret used to HMAC national IDs. Changing it invalidates every stored ID hash. */
  ID_HASH_PEPPER: z.string().min(16),
  KIOSK_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(180),
  KIOSK_MAX_SESSION_SECONDS: z.coerce.number().int().min(60).default(1800),
  KIOSK_MAX_FAILED_IDENTIFY: z.coerce.number().int().min(1).default(5),
  STAFF_SESSION_HOURS: z.coerce.number().int().min(1).default(12),
  VAT_RATE: z.string().regex(/^0(\.\d+)?$/).default('0.18'),
  PRICES_INCLUDE_VAT: bool.default(false),
  ORDER_NUMBER_PREFIX: z.string().regex(/^[A-Z]{1,4}$/).default('W'),
  BUSINESS_TIMEZONE: z.string().default('Asia/Jerusalem'),
  ORDER_PARSER: z.enum(['rules', 'openai']).default('rules'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_PARSER_MODEL: z.string().default('gpt-4.1-mini'),
  STT_PROVIDER: z.enum(['mock', 'openai', 'elevenlabs']).default('mock'),
  OPENAI_STT_MODEL: z.string().default('gpt-4o-transcribe'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_STT_MODEL: z.string().default('scribe_v1'),
  PRINT_AGENT_TOKEN: z.string().min(16),
  PRINT_CLAIM_TIMEOUT_SECONDS: z.coerce.number().int().min(10).default(120),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(240),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.ORDER_PARSER === 'openai' && !cfg.OPENAI_API_KEY) throw new Error('ORDER_PARSER=openai requires OPENAI_API_KEY');
  if (cfg.STT_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) throw new Error('STT_PROVIDER=openai requires OPENAI_API_KEY');
  if (cfg.STT_PROVIDER === 'elevenlabs' && !cfg.ELEVENLABS_API_KEY) throw new Error('STT_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY');
  if (cfg.NODE_ENV === 'production' && cfg.ID_HASH_PEPPER.startsWith('dev-only')) {
    throw new Error('Set a real ID_HASH_PEPPER in production');
  }
  return cfg;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
