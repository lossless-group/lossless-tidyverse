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

/**
 * FileSystemObserver
 * Watches a directory for Markdown (.md) file changes and logs frontmatter.
 * Uses config from USER_OPTIONS (userOptionsConfig.ts) for all directory/template/service logic.
 * For now, only the "tooling" config is used.
 */
export class FileSystemObserver {
  private contentRoot: string;
  private directoryConfig: typeof USER_OPTIONS.directories[0];
  private reportingService: ReportingService;
  private remindersWatcher: RemindersWatcher | null = null;

  /**
   * In-memory set to track files that have already been processed in this session.
   * This prevents infinite loops and duplicate OpenGraph processing.
   * Only files NOT in this set are eligible for OpenGraph processing.
   * The set is reset on process restart (not persisted).
   */
  private static processedFiles = new Set<string>();

  /**
   * @param templateRegistry (unused, for compatibility)
   * @param reportingService (unused, for compatibility)
   * @param contentRoot Directory root (e.g., /Users/mpstaton/code/lossless-monorepo/content)
   */
  constructor(templateRegistry: TemplateRegistry, reportingService: ReportingService, contentRoot: string) {
    this.contentRoot = contentRoot;
    this.reportingService = reportingService;
    // === Directly assign the tooling config from USER_OPTIONS (single source of truth) ===
    // Only the first directory config with template 'tooling' is supported for now.
    this.directoryConfig = USER_OPTIONS.directories[0];
  }

  /**
   * Checks if file is Markdown by extension
   */
  private isMarkdownFile(filePath: string): boolean {
    return filePath.endsWith('.md');
  }

  /**
   * Starts the observer: watches for .md file changes and logs frontmatter
   * Uses the path from USER_OPTIONS tooling config
   */
  public startObserver() {
    // Compute the absolute path to watch using config
    const watchPath = path.join(this.contentRoot, this.directoryConfig.path);
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

    watcher.on('add', this.onChange.bind(this));
    watcher.on('change', this.onChange.bind(this));
  }

  /**
   * Handles file change events (add/change) for Markdown files.
   * Implements the atomic propertyCollector and expectation management pattern.
   * Each subsystem/service receives the full extracted frontmatter, returns an expectation object,
   * and, if acting, returns only changed key-value pairs. The observer merges all results and writes once.
   * Aggressively commented per project rules.
   *
   * @param filePath - Path to the changed Markdown file
   */
  private async onChange(filePath: string) {
    // Only process Markdown files
    if (!this.isMarkdownFile(filePath)) return;
    // === PATCH: Prevent infinite loop by skipping files already processed in this session ===
    if (FileSystemObserver.processedFiles.has(filePath)) {
      if (this.directoryConfig.services.logging?.openGraph) {
        console.log(`[Observer] [SKIP] File already processed in this session, skipping: ${filePath}`);
      }
      return;
    }
    FileSystemObserver.processedFiles.add(filePath);
    try {
      // Read file content
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      // Extract frontmatter (single source of truth)
      const originalFrontmatter = extractFrontmatter(fileContent);
      if (!originalFrontmatter) {
        // Warn if no valid frontmatter found
        console.warn(`[Observer] No valid frontmatter found in ${filePath}`);
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
      // (b) OpenGraph
      const { expectOpenGraph } = await import('./services/openGraphService').then(mod => mod.evaluateOpenGraph(originalFrontmatter, filePath));
      propertyCollector.expectations.expectOpenGraph = expectOpenGraph;

      // --- 2. Execute all subsystems that need to act, collect results ---
      // (a) Site UUID (sync)
      if (propertyCollector.expectations.expectSiteUUID) {
        const { site_uuid } = await import('./handlers/addSiteUUID').then(mod => mod.addSiteUUID(originalFrontmatter, filePath));
        if (site_uuid && site_uuid !== originalFrontmatter.site_uuid) {
          propertyCollector.results.site_uuid = site_uuid;
          if (this.directoryConfig.services.logging?.addSiteUUID) {
            console.log(`[Observer] [addSiteUUID] site_uuid added for ${filePath}:`, site_uuid);
          }
        }
        propertyCollector.expectations.expectSiteUUID = false;
      }
      // (b) OpenGraph (async)
      if (propertyCollector.expectations.expectOpenGraph) {
        // Aggressive, comprehensive, continuous commenting:
        // Call OpenGraph subsystem ONLY to get updated key-values (never writes!)
        // This is the ONLY place where OpenGraph results are merged and written.
        const { ogKeyValues } = await import('./services/openGraphService').then(mod => mod.processOpenGraphKeyValues(originalFrontmatter, filePath));
        // --- Screenshot URL logic (atomic, observer-controlled) ---
        // If og_screenshot_url is still missing, call the screenshot fetcher and merge result
        if (!('og_screenshot_url' in originalFrontmatter)) {
          // Aggressive comment: Only observer triggers screenshot fetch, and only if missing
          const { fetchScreenshotUrl } = await import('./services/openGraphService');
          // Assume frontmatter has 'og_url' or 'url' to use for screenshot
          const targetUrl = originalFrontmatter.og_url || originalFrontmatter.url;
          if (targetUrl) {
            const screenshotUrl = await fetchScreenshotUrl(targetUrl);
            if (screenshotUrl) {
              // Use the atomic, DRY helper (returns updated frontmatter, never writes)
              const { updateFileWithScreenshotUrl } = await import('./services/openGraphService');
              const updatedOgFrontmatter = await updateFileWithScreenshotUrl(filePath, screenshotUrl);
              if (updatedOgFrontmatter && updatedOgFrontmatter.og_screenshot_url) {
                ogKeyValues.og_screenshot_url = updatedOgFrontmatter.og_screenshot_url;
                if (this.directoryConfig.services.logging?.openGraph) {
                  console.log(`[Observer] [fetchScreenshotUrl] Added og_screenshot_url for ${filePath}:`, updatedOgFrontmatter.og_screenshot_url);
                }
              }
            }
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
            if (this.directoryConfig.services.logging?.openGraph) {
              console.log(`[Observer] [og_last_fetch] Set og_last_fetch for ${filePath}: ${ogKeyValues.og_last_fetch}`);
            }
          }
          Object.assign(propertyCollector.results, ogKeyValues);
          if (this.directoryConfig.services.logging?.openGraph) {
            console.log(`[Observer] [fetchOpenGraph] OpenGraph properties updated for ${filePath}:`, ogKeyValues);
          }
        } else if (
          // === PATCH: If OpenGraph subsystem returned no updated fields, but an error occurred, record the error in frontmatter ===
          ogKeyValues && ogKeyValues.og_error_message
        ) {
          // Always write error fields, even if no OG fields were updated
          Object.assign(propertyCollector.results, ogKeyValues);
          if (this.directoryConfig.services.logging?.openGraph) {
            console.log(`[Observer] [og_error] Wrote OpenGraph error fields for ${filePath}:`, ogKeyValues);
          }
        } else {
          // === PATCH: If OpenGraph subsystem returned nothing (timeout, crash, or empty), record a timeout error ===
          // This ensures that even silent failures are recorded in frontmatter and observed by the user.
          propertyCollector.results.og_errors = true;
          propertyCollector.results.og_last_error = new Date().toISOString();
          propertyCollector.results.og_error_message = 'OpenGraph subsystem did not return any data (timeout or crash).';
          if (this.directoryConfig.services.logging?.openGraph) {
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
        if (this.directoryConfig.services.logging?.extractedFrontmatter) {
          console.log(`[Observer] [FINAL] Final frontmatter for ${filePath}:`, updatedFrontmatter);
        }
      } else {
        // Logging: no changes, no write performed
        if (this.directoryConfig.services.logging?.extractedFrontmatter) {
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
    // Example atomic execution (pseudo):
    // for (const { op } of remindersOptions.operationSequence) {
    //   const handler = handlerRegistry[op];
    //   if (handler) await handler(frontmatter, filePath, { reportingService: this.reportingService });
    // }
    // (Actual orchestration logic would be in the main onChange handler or a dedicated orchestrator)
    // This keeps the observer file small and all reminders logic encapsulated.
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
}
