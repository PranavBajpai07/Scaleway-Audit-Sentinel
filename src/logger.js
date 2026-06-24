import fs from "node:fs";
import path from "node:path";

const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger({ logDir, level = "info" }) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "app.log");
  const minLevel = levels[level] ?? levels.info;

  function write(levelName, message, meta = {}) {
    if ((levels[levelName] ?? levels.info) < minLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      ...meta
    };

    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(logFile, line);

    if (levelName === "error") {
      console.error(line.trim());
    } else {
      console.log(line.trim());
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    logFile
  };
}
