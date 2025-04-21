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
    let accumulatedChanges: Record<string, any> = {};
    let operationResults: OperationResult[] = [];
    for (const opStep of this.operationSequence) {
      const handler = this.getOperationHandler(opStep.op);
      if (!handler) {
        operationResults.push({ op: opStep.op, success: false, message: 'Handler not found' });
        continue;
      }
      if (opStep.delayMs) {
        await new Promise(res => setTimeout(res, opStep.delayMs));
      }
      try {
        const result: OperationResult = await handler({ filePath, frontmatter: frontmatter as Record<string, any> });
        operationResults.push({ op: opStep.op, success: true, changes: result.changes });
        if (result.changes) {
          Object.assign(accumulatedChanges, result.changes);
          if (result.writeToDisk) {
            frontmatter = { ...frontmatter, ...result.changes };
            writeFrontmatterToFile(filePath, frontmatter);
            fileContent = fs.readFileSync(filePath, 'utf-8');
            const reExtracted = extractFrontmatter(fileContent);
            if (reExtracted) {
              frontmatter = reExtracted as Record<string, any>;
            } else {
              // Defensive: log and break if frontmatter is now missing
              this.reportingService.logErrorEvent(filePath, ['Frontmatter missing after write, aborting further ops.']);
              break;
            }
          }
        }
      } catch (error: any) {
        operationResults.push({ op: opStep.op, success: false, message: error.message });
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
    const handlers: Record<string, OperationHandler> = {
      addSiteUUID: require('./handlers/addSiteUUID').addSiteUUID,
      updateDateModified: require('./handlers/updateDateModified').updateDateModified,
      extractFrontmatter: async ({ filePath, frontmatter }) => ({ op: 'extractFrontmatter', success: true, changes: {}, writeToDisk: false }),
      fetchOpenGraph: require('./handlers/fetchOpenGraph').fetchOpenGraph,
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
