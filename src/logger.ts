import winston from "winston";

// Define log levels
export const LogLevel = {
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
  TRACE: "trace",
} as const;

// Define log categories for better organization
export const LogCategory = {
  CATALOG: "catalog",
  DEPENDENCY: "dependency",
  CONTAINER: "container",
  MIGRATION: "migration",
  DATABASE: "database",
  GENERAL: "general",
  // Granular debug categories
  GRAPH: "graph",
  DIFF_SCRIPT: "diff-script",
  CATALOG_CHANGES: "catalog-changes",
} as const;

// Parse log filters from environment
const parseLogFilters = (): string[] => {
  const filters = process.env.LOG_FILTERS || "";
  return filters
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
};

const logFilters = parseLogFilters();
const shouldLogCategory = (category: string): boolean => {
  if (logFilters.length === 0) return true; // No filters = show all
  return logFilters.includes(category);
};

// Create the logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "warn",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: {
    service: "pg-diff",
    version: process.env.npm_package_version || "0.0.0",
    environment: process.env.NODE_ENV || "development",
  },
  transports: [
    // Console transport with better formatting for CLI
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(
          ({ timestamp, level, message, category, ...meta }) => {
            const categoryInfo = category ? `[${category}]` : "";
            const metaInfo = Object.keys(meta).length
              ? ` ${JSON.stringify(meta, null, 2)}`
              : "";
            return `${timestamp} ${level}${categoryInfo}: ${message}${metaInfo}`;
          },
        ),
      ),
    }),
  ],
});

// Add file transport for production if needed
if (process.env.NODE_ENV === "production" && process.env.LOG_FILE) {
  logger.add(
    new winston.transports.File({
      filename: process.env.LOG_FILE,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
    }),
  );
}

// Helper functions for structured logging
export const createLogger = (category: keyof typeof LogCategory) => ({
  error: (message: string, meta?: Record<string, unknown>) =>
    logger.error(message, { category, ...meta }),
  warn: (message: string, meta?: Record<string, unknown>) =>
    logger.warn(message, { category, ...meta }),
  info: (message: string, meta?: Record<string, unknown>) =>
    logger.info(message, { category, ...meta }),
  debug: (message: string, meta?: Record<string, unknown>) =>
    logger.debug(message, { category, ...meta }),
  trace: (message: string, meta?: Record<string, unknown>) =>
    logger.debug(message, { category, level: LogLevel.TRACE, ...meta }),
});

// Specialized loggers for different components
export const catalogLogger = createLogger("CATALOG");
export const dependencyLogger = createLogger("DEPENDENCY");
export const containerLogger = createLogger("CONTAINER");
export const migrationLogger = createLogger("MIGRATION");
export const databaseLogger = createLogger("DATABASE");
export const generalLogger = createLogger("GENERAL");

// Granular debug loggers
export const graphLogger = createLogger("GRAPH");
export const diffScriptLogger = createLogger("DIFF_SCRIPT");
export const catalogChangesLogger = createLogger("CATALOG_CHANGES");

// Utility function to log with timing information
export const logWithTiming = async <T>(
  operation: string,
  fn: () => Promise<T>,
  category: keyof typeof LogCategory = "GENERAL",
  meta?: Record<string, unknown>,
): Promise<T> => {
  const startTime = Date.now();
  const operationLogger = createLogger(category);

  operationLogger.debug(`Starting ${operation}`, meta);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    operationLogger.info(`Completed ${operation}`, {
      ...meta,
      duration: `${duration}ms`,
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    operationLogger.error(`Failed ${operation}`, {
      ...meta,
      duration: `${duration}ms`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

// Utility function to log database operations
export const logDatabaseOperation = (
  operation: string,
  sql?: string,
  meta?: Record<string, unknown>,
) => {
  databaseLogger.debug(`Database operation: ${operation}`, {
    sql: sql
      ? sql.substring(0, 200) + (sql.length > 200 ? "..." : "")
      : undefined,
    ...meta,
  });
};

// Utility function to log dependency operations
export const logDependencyOperation = (
  operation: string,
  changes?: unknown[],
  meta?: Record<string, unknown>,
) => {
  dependencyLogger.debug(`Dependency operation: ${operation}`, {
    changeCount: changes?.length,
    ...meta,
  });
};

// Special function for CLI output that preserves formatting and respects filters
export const logCliOutput = (
  message: string,
  data?: unknown,
  category?: string,
) => {
  if (category && !shouldLogCategory(category)) return;

  if (data !== undefined) {
    console.log(message);
    if (typeof data === "string") {
      console.log(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else {
    console.log(message);
  }
};

// Specialized logging functions for debug information
export const logGraph = (graphMermaid: string) => {
  if (!shouldLogCategory("graph")) return;

  console.log("\n=== Dependency Graph ===");
  console.log(graphMermaid);
  console.log("=======================\n");
};

export const logDiffScript = (diffScript: string) => {
  if (!shouldLogCategory("diff-script")) return;

  console.log("\n=== Generated Migration Script ===");
  console.log(diffScript);
  console.log("===================================\n");
};

export const logCatalogChanges = (changes: unknown[]) => {
  if (!shouldLogCategory("catalog-changes")) return;

  console.log("\n=== Catalog Changes ===");
  // Use a simple BigInt serializer for console output
  const serializer = (_key: string, value: unknown) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
  console.log(JSON.stringify(changes, serializer, 2));
  console.log("=====================\n");
};

export default logger;
