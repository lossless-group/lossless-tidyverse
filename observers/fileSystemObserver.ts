// =============================================
// Three-argument Class-Based File System Observer
// Config-driven: uses USER_OPTIONS from userOptionsConfig.ts
// Watches for Markdown file changes and logs frontmatter
// =============================================

import chokidar from 'chokidar';
import { extractFrontmatter, writeFrontmatterToFile, reportPotentialFrontmatterInconsistencies } from './utils/yamlFrontmatter';
import fs from 'fs';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';
// === IMPORT USER_OPTIONS CONFIG ===
import { USER_OPTIONS } from './userOptionsConfig';
import path from 'path';
// === Import addSiteUUID handler ===
import { addSiteUUID } from './handlers/addSiteUUID';
// === Import RemindersWatcher for modular reminders file watching ===
import { RemindersWatcher } from './watchers/remindersWatcher';
import { RemindersWatcherOptions } from './types/watcherTypes';
// --- Import the service-oriented reminders handler ---
import { processRemindersFrontmatter } from './handlers/remindersHandler';
// --- Import VocabularyWatcher for modular vocabulary file watching ---
import { VocabularyWatcher } from './watchers/vocabularyWatcher';
// --- Import EssaysWatcher for modular essays file watching ---
import { EssaysWatcher } from './watchers/essaysWatcher';
// --- Import the centralized processed files tracker ---
import { 
  initializeProcessedFilesTracker, 
  markFileAsProcessed, 
  shouldProcessFile, 
  resetProcessedFilesTracker, 
  shutdownProcessedFilesTracker,
  addCriticalFile,
  processedFilesTracker
} from './utils/processedFilesTracker';

/**
 * FileSystemObserver
 * Watches a directory for Markdown (.md) file changes and logs frontmatter.
 * Uses config from USER_OPTIONS (userOptionsConfig.ts) for all directory/template/service logic.
 * For now, only the "tooling" config is used.
 */
export class FileSystemObserver {
  private contentRoot: string;
  private directoryConfigs: typeof USER_OPTIONS.directories;
  private reportingService: ReportingService;
  private remindersWatcher: RemindersWatcher | null = null;
  private vocabularyWatcher: VocabularyWatcher | null = null;
  private essaysWatcher: EssaysWatcher | null = null;
  private shutdownInitiated: boolean = false;

  /**
   * Reset the processed files set
   * This should be called when the observer is started to ensure a clean slate
   */
  public resetProcessedFiles(): void {
    console.log('[Observer] Resetting processed files tracking');
    resetProcessedFilesTracker();
    console.log('[Observer] Processed files tracking reset complete');
  }

  /**
   * Add a file to the processed files set
   * This prevents the file from being processed again in this session
   * @param filePath Path to the file to mark as processed
   */
  public markFileAsProcessed(filePath: string): void {
    markFileAsProcessed(filePath);
  }

  /**
   * Check if a file has been processed in this session
   * @param filePath Path to the file to check
   * @returns True if the file has been processed, false otherwise
   */
  public hasFileBeenProcessed(filePath: string): boolean {
    return !shouldProcessFile(filePath);
  }

  /**
   * @param templateRegistry (unused, for compatibility)
   * @param reportingService (unused, for compatibility)
   * @param contentRoot Directory root (e.g., /Users/mpstaton/code/lossless-monorepo/content)
   */
  constructor(templateRegistry: TemplateRegistry, reportingService: ReportingService, contentRoot: string) {
    this.contentRoot = contentRoot;
    this.reportingService = reportingService;
    // Use all directory configurations from USER_OPTIONS
    this.directoryConfigs = USER_OPTIONS.directories;
    // Register shutdown hooks bound to this instance
    const boundShutdown = this.handleShutdown.bind(this);
    process.on('SIGINT', boundShutdown);
    process.on('SIGTERM', boundShutdown);
    process.on('exit', boundShutdown);
    
    // Initialize the processed files tracker with critical files from USER_OPTIONS
    initializeProcessedFilesTracker({
      criticalFiles: USER_OPTIONS.criticalFiles || []
    });
    
    console.log('[Observer] FileSystemObserver initialized with clean processed files state');
    if (USER_OPTIONS.criticalFiles && USER_OPTIONS.criticalFiles.length > 0) {
      console.log(`[Observer] Critical files configured: ${USER_OPTIONS.criticalFiles.join(', ')}`);
    }
  }

  /**
   * Checks if file is Markdown by extension
   */
  private isMarkdownFile(filePath: string): boolean {
    return filePath.endsWith('.md');
  }

  /**
   * Starts the observer: watches for .md file changes in all configured directories
   */
  public startObserver() {
    // Watch all configured directories
    for (const dirConfig of this.directoryConfigs) {
      const watchPath = path.join(this.contentRoot, dirConfig.path);
      console.log(`[Observer] Watching for Markdown file changes in: ${watchPath}`);
      
      const watcher = chokidar.watch(watchPath, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: 10,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      });

      // Bind the onChange handler with the specific directory config
      watcher.on('add', (filePath) => this.onChange(filePath, dirConfig));
      watcher.on('change', (filePath) => this.onChange(filePath, dirConfig));
    }
  }

  /**
   * Handles file change events (add/change) for Markdown files.
   * 
   * @param filePath - Path to the changed Markdown file
   * @param dirConfig - The directory configuration that matches this file
   */
  private async onChange(filePath: string, dirConfig: typeof USER_OPTIONS.directories[0]) {
    // Only process Markdown files
    if (!this.isMarkdownFile(filePath)) return;
    // === PATCH: Prevent infinite loop by skipping files already processed in this session ===
    if (this.hasFileBeenProcessed(filePath)) {
      if (dirConfig.services.logging?.openGraph) {
        console.log(`[Observer] [SKIP] File already processed in this session, skipping: ${filePath}`);
      }
      return;
    }
    this.markFileAsProcessed(filePath);
    try {
      // Read file content
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      // Extract frontmatter (single source of truth)
      const originalFrontmatter = extractFrontmatter(fileContent);
      if (!originalFrontmatter) {
        // No valid frontmatter found - this is a primary use case!
        // For the main observer, we'll log this but let the specialized watchers handle it
        // This is because the main observer doesn't know which template to apply
        console.log(`[Observer] No frontmatter found in ${filePath} - specialized watchers will handle this file`);
        return;
      }

      // Aggressive, redundant commenting: always clarify logic and all places this function is called.
      // ---
      // propertyCollector pattern: each subsystem returns ONLY the fields it intends to update (never the whole frontmatter).
      // The orchestrator merges these partials into a collector, then overlays the collector onto the original frontmatter.
      // This prevents infinite loops and guarantees no user data is dropped unless explicitly overwritten.

      // === Interface for property expectations ===
      interface PropertyExpectations {
        expectSiteUUID: boolean;
        expectOpenGraph: boolean;
        // Add more expectation flags as needed
      }

      // === Atomic Property Collector & Expectation Management ===
      const propertyCollector: {
        expectations: PropertyExpectations;
        results: Record<string, any>;
      } = {
        expectations: {
          expectSiteUUID: false,
          expectOpenGraph: false,
        },
        results: {},      // key-value pairs to merge
      };
      // No mutation of originalFrontmatter until final merge

      // --- 1. Evaluate all subsystems and collect expectations ---
      // (a) Site UUID
      const { expectSiteUUID } = await import('./handlers/addSiteUUID').then(mod => mod.evaluateSiteUUID(originalFrontmatter, filePath));
      propertyCollector.expectations.expectSiteUUID = expectSiteUUID;
      // (b) OpenGraph - ONLY evaluate if enabled in directory config
      if (dirConfig.services.openGraph === true) {
        const { expectOpenGraph } = await import('./services/openGraphService').then(mod => mod.evaluateOpenGraph(originalFrontmatter, filePath));
        propertyCollector.expectations.expectOpenGraph = expectOpenGraph;
      } else {
        // OpenGraph is explicitly disabled for this directory
        propertyCollector.expectations.expectOpenGraph = false;
        if (dirConfig.services.logging?.openGraph) {
          console.log(`[Observer] [OpenGraph] OpenGraph is disabled for ${filePath} (directory config: openGraph: false)`);
        }
      }

      // --- 2. Execute all subsystems that need to act, collect results ---
      // (a) Site UUID (sync)
      if (propertyCollector.expectations.expectSiteUUID) {
        // addSiteUUID now returns { changes, writeToDisk } (never a top-level site_uuid)
        const addSiteUUIDResult = await import('./handlers/addSiteUUID').then(mod => mod.addSiteUUID(originalFrontmatter, filePath));
        const siteUUID = (addSiteUUIDResult.changes as Record<string, any> | undefined)?.site_uuid;
        if (siteUUID && siteUUID !== (originalFrontmatter as Record<string, any>).site_uuid) {
          propertyCollector.results.site_uuid = siteUUID;
          if (dirConfig.services.logging?.addSiteUUID) {
            console.log(`[Observer] [addSiteUUID] site_uuid added for ${filePath}:`, siteUUID);
          }
        }
        propertyCollector.expectations.expectSiteUUID = false;
      }
      // (b) OpenGraph (async) - ONLY process if enabled in directory config
      if (propertyCollector.expectations.expectOpenGraph && dirConfig.services.openGraph === true) {
        // Aggressive, comprehensive, continuous commenting:
        // Call OpenGraph subsystem ONLY to get updated key-values (never writes!)
        // This is the ONLY place where OpenGraph results are merged and written.
        const { ogKeyValues } = await import('./services/openGraphService').then(mod => mod.processOpenGraphKeyValues(originalFrontmatter, filePath));
        // --- Screenshot URL logic (atomic, observer-controlled) ---
        // If og_screenshot_url is still missing, call the screenshot fetcher and merge result
        if (!('og_screenshot_url' in originalFrontmatter)) {
          // Aggressive comment: Only observer triggers screenshot fetch, and only if missing
          const { fetchScreenshotUrl } = await import('./services/openGraphService');
          // Only fetch screenshot if OpenGraph is enabled for this directory
          if (dirConfig.services.openGraph === true) {
            // Only fetch screenshot if we have a URL to fetch from
            if ('og_url' in ogKeyValues && typeof ogKeyValues.og_url === 'string') {
              try {
                const screenshotUrl = await fetchScreenshotUrl(ogKeyValues.og_url);
                if (screenshotUrl) {
                  ogKeyValues.og_screenshot_url = screenshotUrl;
                  if (dirConfig.services.logging?.openGraph) {
                    console.log(`[Observer] [fetchScreenshotUrl] og_screenshot_url added for ${filePath}:`, screenshotUrl);
                  }
                }
              } catch (err) {
                console.error(`[Observer] [fetchScreenshotUrl] Error fetching screenshot URL for ${filePath}:`, err);
              }
            }
          } else if (dirConfig.services.logging?.openGraph) {
            console.log(`[Observer] [fetchScreenshotUrl] Screenshot URL fetching is disabled for ${filePath} (directory config: openGraph: false)`);
          }
        }
        if (ogKeyValues && Object.keys(ogKeyValues).length > 0) {
          // === PATCH: Always update og_last_fetch if any OG field is updated ===
          // Only the orchestrator (observer) is allowed to set og_last_fetch, and only if any OG field or og_screenshot_url is present in ogKeyValues.
          // og_last_fetch must never trigger another loop, and must be a non-triggering, observer-controlled property.
          const ogKeys = [
            'og_image', 'og_url', 'video', 'favicon', 'site_name', 'title', 'description', 'og_images', 'og_screenshot_url'
          ];
          const anyOgFieldChanged = ogKeys.some(key => key in ogKeyValues);
          if (anyOgFieldChanged) {
            ogKeyValues.og_last_fetch = new Date().toISOString();
            if (dirConfig.services.logging?.openGraph) {
              console.log(`[Observer] [og_last_fetch] Set og_last_fetch for ${filePath}: ${ogKeyValues.og_last_fetch}`);
            }
          }
          Object.assign(propertyCollector.results, ogKeyValues);
          if (dirConfig.services.logging?.openGraph) {
            console.log(`[Observer] [fetchOpenGraph] OpenGraph properties updated for ${filePath}:`, ogKeyValues);
          }
        } else if (
          // === PATCH: If OpenGraph subsystem returned no updated fields, but an error occurred, record the error in frontmatter ===
          ogKeyValues && ogKeyValues.og_error_message
        ) {
          // Always write error fields, even if no OG fields were updated
          Object.assign(propertyCollector.results, ogKeyValues);
          if (dirConfig.services.logging?.openGraph) {
            console.log(`[Observer] [og_error] Wrote OpenGraph error fields for ${filePath}:`, ogKeyValues);
          }
        } else {
          // === PATCH: If OpenGraph subsystem returned nothing (timeout, crash, or empty), record a timeout error ===
          // This ensures that even silent failures are recorded in frontmatter and observed by the user.
          propertyCollector.results.og_errors = true;
          propertyCollector.results.og_last_error = new Date().toISOString();
          propertyCollector.results.og_error_message = 'OpenGraph subsystem did not return any data (timeout or crash).';
          if (dirConfig.services.logging?.openGraph) {
            console.log(`[Observer] [og_error] Timeout or empty result for ${filePath}, wrote og_error_message.`);
          }
        }
      }

      // --- 3. Final merge, update date_modified, write if any changes ---
      if (Object.keys(propertyCollector.results).length > 0) {
        // Update date_modified first
        const dateNow = new Date().toISOString();
        propertyCollector.results.date_modified = dateNow;
        // Merge: overlay the collector on the original frontmatter (never write only the collector)
        const updatedFrontmatter = { ...originalFrontmatter, ...propertyCollector.results };
        await writeFrontmatterToFile(filePath, updatedFrontmatter);
        // Logging: final frontmatter written
        if (dirConfig.services.logging?.extractedFrontmatter) {
          console.log(`[Observer] [FINAL] Final frontmatter for ${filePath}:`, updatedFrontmatter);
        }
      } else {
        // Logging: no changes, no write performed
        if (dirConfig.services.logging?.extractedFrontmatter) {
          console.log(`[Observer] [FINAL] No changes for ${filePath}; no write performed.`);
        }
      }
    } catch (err) {
      // Log error if reading or writing fails
      console.error(`[Observer] ERROR processing ${filePath}:`, err);
    }
  }

  /**
   * Example: Set up and start the RemindersWatcher alongside the main observer.
   * This demonstrates correct instantiation using project conventions.
   *
   * Aggressive comments: All options are explicit; types are imported from watcherTypes.
   * Directory, operation sequence, and reportingService are passed from config/context.
   */
  public startRemindersWatcher() {
    // --- Configure the watcher options ---
    const remindersOptions: RemindersWatcherOptions = {
      directory: path.join(this.contentRoot, 'lost-in-public/reminders'), // Adjust as needed
      operationSequence: [
        { op: 'addSiteUUID' },
        { op: 'processRemindersFrontmatter' }, // Service-oriented, atomic handler
        // Add more ops as needed
      ],
      reportingService: this.reportingService,
      sendReport: (report) => {
        // Handle or log the watcher report as needed
        console.log('[RemindersWatcher] Report:', report);
      },
    };
    // --- Handler registry for atomic, service-oriented ops ---
    const handlerRegistry = {
      addSiteUUID: require('./handlers/addSiteUUID').addSiteUUID,
      processRemindersFrontmatter,
      // Add more handlers here as needed
    };
    // --- ACTUALLY INSTANTIATE AND START THE REMINDERSWATCHER ---
    this.remindersWatcher = new RemindersWatcher(remindersOptions);
    this.remindersWatcher.start();
  }

  /**
   * Example: Stop the RemindersWatcher if running.
   */
  public stopRemindersWatcher() {
    if (this.remindersWatcher) {
      this.remindersWatcher.stop();
      this.remindersWatcher = null;
    }
  }

  /**
   * Set up and start the VocabularyWatcher alongside the main observer.
   * This ensures that files in the vocabulary directory are properly processed
   * according to the vocabulary template configuration.
   * 
   * Aggressive comments: The VocabularyWatcher is a specialized watcher that handles
   * vocabulary-specific processing and validation. It works in parallel with the main
   * observer to ensure that vocabulary files are properly processed.
   */
  public startVocabularyWatcher() {
    // Find the vocabulary directory configuration from USER_OPTIONS
    const vocabDirConfig = this.directoryConfigs.find(d => d.template === 'vocabulary');
    
    if (!vocabDirConfig) {
      console.warn('[Observer] No vocabulary directory configuration found in USER_OPTIONS. VocabularyWatcher not started.');
      return;
    }
    
    // Construct the full path to the vocabulary directory
    const vocabularyDir = path.join(this.contentRoot, vocabDirConfig.path);
    
    // Verify the directory exists
    if (!fs.existsSync(vocabularyDir)) {
      console.warn(`[Observer] Vocabulary directory not found at ${vocabularyDir}. VocabularyWatcher not started.`);
      return;
    }
    
    console.log(`[Observer] Starting VocabularyWatcher for directory: ${vocabularyDir}`);
    
    // Instantiate and start the VocabularyWatcher with the vocabulary directory path
    // Now using the centralized processed files tracker instead of callbacks
    this.vocabularyWatcher = new VocabularyWatcher(
      this.reportingService, 
      vocabularyDir
    );
    this.vocabularyWatcher.start();
    
    console.log('[Observer] VocabularyWatcher started successfully.');
  }

  /**
   * Stop the VocabularyWatcher if running.
   */
  public stopVocabularyWatcher() {
    if (this.vocabularyWatcher) {
      this.vocabularyWatcher.stop();
      this.vocabularyWatcher = null;
      console.log('[Observer] VocabularyWatcher stopped.');
    }
  }

  /**
   * Set up and start the EssaysWatcher alongside the main observer.
   * This ensures that files in the essays directory are properly processed
   * according to the essays template configuration.
   * 
   * Aggressive comments: The EssaysWatcher is a specialized watcher that handles
   * essays-specific processing and validation. It works in parallel with the main
   * observer to ensure that essay files are properly processed.
   */
  public startEssaysWatcher() {
    // Find the essays directory configuration from USER_OPTIONS
    const essaysDirConfig = this.directoryConfigs.find(d => d.template === 'essays');
    
    if (!essaysDirConfig) {
      console.warn('[Observer] No essays directory configuration found in USER_OPTIONS. EssaysWatcher not started.');
      return;
    }
    
    // Construct the full path to the essays directory
    const essaysDir = path.join(this.contentRoot, essaysDirConfig.path);
    
    // Verify the directory exists
    if (!fs.existsSync(essaysDir)) {
      console.warn(`[Observer] Essays directory not found at ${essaysDir}. EssaysWatcher not started.`);
      return;
    }
    
    console.log(`[Observer] Starting EssaysWatcher for directory: ${essaysDir}`);
    
    // Instantiate and start the EssaysWatcher with the essays directory path
    // Now using the centralized processed files tracker instead of callbacks
    this.essaysWatcher = new EssaysWatcher(
      this.reportingService, 
      essaysDir
    );
    this.essaysWatcher.start();
    
    console.log('[Observer] EssaysWatcher started successfully.');
  }

  /**
   * Stop the EssaysWatcher if running.
   */
  public stopEssaysWatcher() {
    if (this.essaysWatcher) {
      this.essaysWatcher.stop();
      this.essaysWatcher = null;
      console.log('[Observer] EssaysWatcher stopped.');
    }
  }

  /**
   * Idempotent shutdown handler: writes final report on shutdown signal.
   */
  private async handleShutdown() {
    if (this.shutdownInitiated) return;
    this.shutdownInitiated = true;
    try {
      // Log shutdown initiation
      if (this.reportingService) {
        this.reportingService.logShutdownInitiated();
        // Log processed files count for diagnostics using the tracker
        this.reportingService.logShutdownDiagnostic(`Processed files count at shutdown: ${processedFilesTracker.getProcessedFilesCount()}`);
      }

      // Check for pending operations using Node.js process inspection
      // Note: This uses Node.js internal APIs that aren't in the TypeScript types
      try {
        // Cast process to any to access internal methods
        const nodeProcess = process as any;
        const activeHandles = nodeProcess._getActiveHandles?.() || [];
        const activeRequests = nodeProcess._getActiveRequests?.() || [];
        const pendingCount = activeHandles.length + activeRequests.length;
        
        if (pendingCount > 0 && this.reportingService) {
          this.reportingService.logShutdownDiagnostic(`Active handles/requests at shutdown: ${pendingCount}`);
          // Log details about the types of handles
          const handleTypes = activeHandles.map((h: any) => h.constructor?.name || typeof h).join(', ');
          this.reportingService.logShutdownDiagnostic(`Handle types: ${handleTypes || 'unknown'}`);
        }
      } catch (inspectError) {
        // Safely handle errors from process inspection
        console.warn('[Observer] Unable to inspect process for active handles:', inspectError);
      }

      // Stop any active watchers
      this.stopRemindersWatcher();
      this.stopVocabularyWatcher();
      this.stopEssaysWatcher();
      
      console.log('[Observer] Shutdown signal received. Writing final report...');
      if (this.reportingService && typeof this.reportingService.writeReport === 'function') {
        try {
          // Log completion before writing report
          this.reportingService.logShutdownCompleted();
          
          const reportPath = await this.reportingService.writeReport();
          if (reportPath) {
            console.log(`[Observer] Final report written to: ${reportPath}`);
          } else {
            console.warn('[Observer] No report was generated (no files processed).');
          }
        } catch (reportError) {
          const errorMessage = reportError instanceof Error ? reportError.message : String(reportError);
          console.error('[Observer] Error writing final report:', errorMessage);
          if (this.reportingService) {
            this.reportingService.logShutdownDiagnostic(`Error writing final report: ${errorMessage}`);
          }
        }
      } else {
        console.error('[Observer] ReportingService is not available or misconfigured. Final report NOT written.');
      }
    } catch (shutdownError) {
      const errorMessage = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
      console.error('[Observer] Error during shutdown report generation:', errorMessage);
      if (this.reportingService) {
        this.reportingService.logShutdownDiagnostic(`Error during shutdown: ${errorMessage}`);
      }
    } finally {
      
      // CRITICAL: Explicitly shut down the processed files tracker before exiting
      // This ensures that when the process is restarted, it starts with a clean slate
      console.log('[Observer] Shutting down processed files tracker');
      shutdownProcessedFilesTracker();
      
      console.log('[Observer] Exiting in 250ms...');
      setTimeout(() => {
        console.log('[Observer] Process exit now.');
        process.exit(0);
      }, 250);
    }
  }
}
