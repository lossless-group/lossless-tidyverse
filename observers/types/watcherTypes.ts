// -----------------------------------------------------------------------------
// watcherTypes.ts
// Types for modular file system watchers (e.g., remindersWatcher)
// -----------------------------------------------------------------------------

export type HandlerArgs = { filePath: string; frontmatter: Record<string, any> };

export interface OperationResult {
  op: string;
  success: boolean;
  message?: string;
  changes?: Record<string, any>;
  writeToDisk?: boolean;
}

export type OperationHandler = (args: HandlerArgs) => Promise<OperationResult>;

export interface WatcherReport {
  filePath: string;
  changes: Record<string, any>;
  operationResults: OperationResult[];
}

export interface RemindersWatcherOptions {
  directory: string;
  operationSequence: { op: string; delayMs?: number }[];
  reportingService: any; // Use a more specific type if available
  sendReport: (report: WatcherReport) => void;
}
