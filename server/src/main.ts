import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startHttpServer } from "./http";

/**
 * .env.development 파일에서 환경변수를 로드한다.
 * dotenv 패키지 없이 직접 파싱 (의존성 최소화).
 */
function loadEnvFile(filename: string) {
  const filePath = resolve(process.cwd(), filename);
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // 파일이 없으면 무시 (production에서는 시스템 환경변수 사용)
  }
}

const appEnv = process.env.APP_ENV ?? "dev";
loadEnvFile(`.env.${appEnv === "dev" ? "development" : appEnv}`);
loadEnvFile(".env");

const port = Number(process.env.PORT ?? 8080);
startHttpServer(port);
