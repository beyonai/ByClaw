export interface AppConfig {
  host: string;
  port: number;
  corsOrigin: string | boolean;
  piProvider?: string;
  piModel?: string;
  openAiBaseUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received: ${env.PORT}`);
  }

  return {
    host: env.HOST ?? "0.0.0.0",
    port,
    corsOrigin: env.CORS_ORIGIN === "*" || !env.CORS_ORIGIN ? true : env.CORS_ORIGIN,
    ...(env.PI_PROVIDER ? { piProvider: env.PI_PROVIDER } : {}),
    ...(env.PI_MODEL ? { piModel: env.PI_MODEL } : {}),
    ...(env.OPENAI_BASE_URL ? { openAiBaseUrl: env.OPENAI_BASE_URL } : {}),
  };
}
