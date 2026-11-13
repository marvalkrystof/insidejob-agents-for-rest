import { existsSync } from "node:fs";

const ENV_FILE_PATH = ".env";

export const loadEnvFileIfPresent = (): void => {
  if (!existsSync(ENV_FILE_PATH)) {
    return;
  }
  process.loadEnvFile(ENV_FILE_PATH);
};

export const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  return value;
};

export const requireEnv = (name: string): string => {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing environment variable ${name} (add it to .env)`);
  }
  return value;
};
