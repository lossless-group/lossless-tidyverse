// -----------------------------------------------------------------------------
// remindersWatcher.ts
// Modular watcher for the 'reminders' content collection.
// Watches a user-specified directory, applies an operation sequence, accumulates changes,
// and reports results back to the observer for final report writing.
// -----------------------------------------------------------------------------

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { extractFrontmatter, writeFrontmatterToFile } from '../utils/yamlFrontmatter';
import { ReportingService } from '../services/reportingService';
import remindersTemplate from '../templates/reminders';
import { RemindersWatcherOptions, WatcherReport, HandlerArgs, OperationHandler, OperationResult } from '../types/watcherTypes';
import { isEnabledForPath } from '../utils/commonUtils';
import { addSiteUUID } from '../handlers/addSiteUUID';

/**
 * Modular watcher for reminders content collection
 */
export class RemindersWatcher {
  private directory: string;
  private operationSequence: { op: string; delayMs?: number }[];
  private reportingService: ReportingService;
  private sendReport: (report: WatcherReport) => void;
  private watcher: chokidar.FSWatcher | null = null;

  constructor(options: RemindersWatcherOptions) {
    this.directory = options.directory;
    this.operationSequence = options.operationSequence;
    this.reportingService = options.reportingService;
    this.sendReport = options.sendReport;
  }

  /**
   * Start watching the reminders directory
   */
  public start() {
    this.watcher = chokidar.watch(this.directory, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 10,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });
    this.watcher.on('add', this.onChange.bind(this));
    this.watcher.on('change', this.onChange.bind(this));
    console.log(`[RemindersWatcher] Watching directory: ${this.directory}`);
  }

  /**
   * Handler for file changes
   */
  private async onChange(filePath: string) {
    // Aggressive ON/OFF logic: skip if addSiteUUID is disabled for this path
    if (!isEnabledForPath(filePath, 'addSiteUUID')) {
      console.log(`[RemindersWatcher] addSiteUUID is disabled for ${filePath} (via userOptionsConfig)`);
      return;
    }
    if (!filePath.endsWith('.md')) return;
    let fileContent = fs.readFileSync(filePath, 'utf-8');
    let frontmatter = extractFrontmatter(fileContent);
    if (!frontmatter) {
      console.warn(`[RemindersWatcher] No valid frontmatter found in ${filePath}`);
      return;
    }
    // --- Use remindersTemplate for validation and reporting ---
    const validationResults: string[] = [];
    for (const [field, config] of Object.entries(remindersTemplate.required)) {
      if (typeof config.validation === 'function') {
        const valid = config.validation(frontmatter[field]);
        if (!valid) {
          validationResults.push(`Field '${field}' is missing or invalid.`);
        }
      }
    }
    if (validationResults.length > 0) {
      this.reportingService.logErrorEvent(filePath, validationResults);
    }
    // --- AGGREGATE CHANGES FROM ALL HANDLERS BEFORE WRITING ---
    let accumulatedChanges: Record<string, any> = {};
    // 1. Always run addSiteUUID first if enabled
    const addSiteUUIDResult = addSiteUUID(frontmatter, filePath);
    if (addSiteUUIDResult.changes && Object.keys(addSiteUUIDResult.changes).length > 0) {
      Object.assign(accumulatedChanges, addSiteUUIDResult.changes);
    }
    // 2. Run operationSequence handlers (excluding addSiteUUID)
    let operationResults: OperationResult[] = [];
    for (const opStep of this.operationSequence) {
      if (opStep.op === 'addSiteUUID') continue; // already handled
      const handler = this.getOperationHandler(opStep.op);
      if (!handler) {
        operationResults.push({ op: opStep.op, success: false, message: 'Handler not found' });
        continue;
      }
      if (opStep.delayMs) {
        await new Promise(res => setTimeout(res, opStep.delayMs));
      }
      try {
        // FIX: Always pass the latest merged frontmatter to each handler
        const mergedFrontmatter = { ...frontmatter, ...accumulatedChanges };
        const result: OperationResult = await handler({ filePath, frontmatter: mergedFrontmatter });
        operationResults.push({ op: opStep.op, success: true, changes: result.changes });
        if (result.changes && Object.keys(result.changes).length > 0) {
          Object.assign(accumulatedChanges, result.changes);
        }
      } catch (error: any) {
        operationResults.push({ op: opStep.op, success: false, message: error.message });
      }
    }
    // Only write once, after all handlers, if any changes
    if (Object.keys(accumulatedChanges).length > 0) {
      frontmatter = { ...frontmatter, ...accumulatedChanges };
      writeFrontmatterToFile(filePath, frontmatter);
      fileContent = fs.readFileSync(filePath, 'utf-8');
      const reExtracted = extractFrontmatter(fileContent);
      if (reExtracted) {
        frontmatter = reExtracted as Record<string, any>;
      } else {
        this.reportingService.logErrorEvent(filePath, ['Frontmatter missing after write, aborting further ops.']);
      }
    }
    this.sendReport({ filePath, changes: accumulatedChanges, operationResults });
  }

  /**
   * Returns the handler function for a given operation name
   */
  private getOperationHandler(op: string): OperationHandler | undefined {
    // Example: map operation names to handler functions
    // Handlers must be implemented elsewhere and imported
    const reportingService = this.reportingService;
    const handlers: Record<string, OperationHandler> = {
      processRemindersFrontmatter: async ({ frontmatter, filePath }) =>
        require('../handlers/remindersHandler').processRemindersFrontmatter(frontmatter, filePath, { reportingService }),
      extractFrontmatter: async () => ({ op: 'extractFrontmatter', success: true, changes: {}, writeToDisk: false }),
      // Add more handlers as needed
    };
    return handlers[op];
  }

  /**
   * Stop watching
   */
  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log(`[RemindersWatcher] Stopped watching directory: ${this.directory}`);
    }
  }
}
