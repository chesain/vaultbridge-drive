import { redact } from "./redaction";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

export interface LogRecord {
  at: string;
  level: LogLevel;
  event: string;
  context?: unknown;
}

export type LogSink = (record: LogRecord) => void;

export class Logger {
  constructor(
    private level: LogLevel = "info",
    private readonly sink: LogSink = (record) => console.log(JSON.stringify(record)),
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  error(event: string, context?: unknown): void {
    this.emit("error", event, context);
  }

  warn(event: string, context?: unknown): void {
    this.emit("warn", event, context);
  }

  info(event: string, context?: unknown): void {
    this.emit("info", event, context);
  }

  debug(event: string, context?: unknown): void {
    this.emit("debug", event, context);
  }

  trace(event: string, context?: unknown): void {
    this.emit("trace", event, context);
  }

  private emit(level: LogLevel, event: string, context?: unknown): void {
    if (LEVELS[level] > LEVELS[this.level]) return;
    const record: LogRecord = {
      at: new Date().toISOString(),
      level,
      event: String(redact(event)),
    };
    if (context !== undefined) record.context = redact(context);
    this.sink(record);
  }
}
