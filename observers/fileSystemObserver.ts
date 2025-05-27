// =============================================
// Three-argument Class-Based File System Observer
// Config-driven: uses USER_OPTIONS from userOptionsConfig.ts
// Watches for Markdown file changes and logs frontmatter
// =============================================

import chokidar from 'chokidar';
import { extractFrontmatter, writeFrontmatterToFile, reportPotentialFrontmatterInconsistencies } from './utils/yamlFrontmatter';
import { formatDate } from './utils/commonUtils'; // Added import for date formatting
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
// --- Import ConceptsWatcher for modular concepts file watching ---
import { ConceptsWatcher } from './watchers/conceptsWatcher';
// --- Import EssaysWatcher for modular essays file watching ---
import { EssaysWatcher } from './watchers/essaysWatcher';
// --- Import ToolingWatcher for modular tooling file watching ---
import { ToolingWatcher } from './watchers/toolkitWatcher';
// --- Import IssueResolutionProcessor for issue-resolution collection ---
import { IssueResolutionProcessor } from './watchers/issueResolutionWatcher';
// --- Import ImageKitService for screenshot processing ---
import { ImageKitService } from './services/imageKitService';
// --- Import the centralized processed files tracker ---
import { 
  initializeProcessedFilesTracker, 
  markFileAsProcessed, 
  shouldProcessFile, 
  resetProcessedFilesTracker, 
  shutdownProcessedFilesTracker,
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
  private templateRegistry: TemplateRegistry;
  private remindersWatcher: RemindersWatcher | null = null;
  private vocabularyWatcher: VocabularyWatcher | null = null;
  private conceptsWatcher: ConceptsWatcher | null = null;
  private essaysWatcher: EssaysWatcher | null = null;
  private toolingWatcher: ToolingWatcher | null = null;
  private shutdownInitiated: boolean = false;
  // === Add Service Instances ===
  private issueResolutionProcessor: IssueResolutionProcessor | null = null;
  private imageKitService: ImageKitService | null = null;

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
   * @param templateRegistry 
   * @param reportingService 
   * @param contentRoot Directory root (e.g., /Users/mpstaton/code/lossless-monorepo/content)
   */
  constructor(templateRegistry: TemplateRegistry, reportingService: ReportingService, contentRoot: string) {
    this.contentRoot = contentRoot;
    this.reportingService = reportingService;
    this.templateRegistry = templateRegistry;
    // Use all directory configurations from USER_OPTIONS
    this.directoryConfigs = USER_OPTIONS.directories;
    // === Instantiate Services ===
    this.issueResolutionProcessor = new IssueResolutionProcessor(this.templateRegistry, this.reportingService);
    
    // Initialize ImageKitService if any directory has it enabled
    if (this.directoryConfigs.some(config => config.services.imageKit?.enabled)) {
      // Find the first config with ImageKit enabled to initialize the service
      const imageKitConfig = this.directoryConfigs.find(config => config.services.imageKit?.enabled)?.services.imageKit;
      if (imageKitConfig) {
        this.imageKitService = new ImageKitService(imageKitConfig);
        console.log('[Observer] ImageKitService initialized');
      }
    }
    
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
  /**
   * Process all existing Markdown files in a directory to update screenshots
   * This is a specialized version of processExistingFiles that only handles screenshots
   * @param dirPath Relative path from content root (e.g., 'tooling/Enterprise Jobs-to-be-Done')
   */
  public async processScreenshotsForExistingFiles(dirPath: string) {
    const dirConfig = this.directoryConfigs.find(c => 
      path.normalize(c.path) === path.normalize(dirPath)
    );
    
    if (!dirConfig) {
      console.error(`[Observer] No configuration found for directory: ${dirPath}`);
      return;
    }

    // Skip if ImageKit is not enabled for this directory
    if (!dirConfig.services.imageKit?.enabled || !this.imageKitService) {
      console.log(`[Observer] [ImageKit] Screenshot processing is disabled for directory: ${dirPath}`);
      return;
    }

    const fullPath = path.join(this.contentRoot, dirPath);
    
    try {
      // Check if directory exists
      await fs.promises.access(fullPath, fs.constants.R_OK);
      
      // Read all markdown files recursively
      const files: string[] = [];
      const readDir = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await readDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      };
      
      await readDir(fullPath);
      
      console.log(`[Observer] [ImageKit] Found ${files.length} Markdown files to process for screenshots in ${dirPath}`);
      
      // Process each file for screenshots only
      for (const filePath of files) {
        try {
          // Read file content
          const fileContent = await fs.promises.readFile(filePath, 'utf-8');
          const frontmatter = extractFrontmatter(fileContent);
          
          if (!frontmatter) {
            console.log(`[Observer] [ImageKit] No frontmatter found in ${filePath}, skipping`);
            continue;
          }
          
          // Only process if we have a URL and either don't have a screenshot or we're forcing overwrite
          const imageUrl = frontmatter.open_graph_url || frontmatter.url;
          if (!imageUrl) {
            console.log(`[Observer] [ImageKit] No URL found in ${filePath}, skipping`);
            continue;
          }
          
          if (frontmatter.og_screenshot_url && dirConfig.services.imageKit.overwriteScreenshotUrl !== true) {
            console.log(`[Observer] [ImageKit] Screenshot already exists for ${filePath} and overwrite is disabled, skipping`);
            continue;
          }
          
          // Process the screenshot - create a copy of frontmatter to prevent modifications
          console.log(`[Observer] [ImageKit] Processing screenshot for ${filePath}`);
          const frontmatterCopy = JSON.parse(JSON.stringify(frontmatter));
          const imageKitUrl = await this.imageKitService.processScreenshots(filePath, frontmatterCopy);
          
          if (imageKitUrl) {
            // Update the file with the new ImageKit URL
            console.log(`[Observer] [ImageKit] Updating file with ImageKit URL: ${imageKitUrl}`);
            
            // Import the YAML frontmatter utilities
            const { updateFrontmatter, writeFrontmatterToFile } = await import('./utils/yamlFrontmatter');
            
            try {
              // Read the current file content
              const content = await fs.promises.readFile(filePath, 'utf8');
              
              // Update the frontmatter with the new ImageKit URL
              const updatedFrontmatter = {
                ...frontmatter,
                og_screenshot_url: imageKitUrl
              };
              
              // Update the file content with the new frontmatter
              const updatedContent = updateFrontmatter(content, updatedFrontmatter);
              
              // Write the updated content back to the file
              await fs.promises.writeFile(filePath, updatedContent, 'utf8');
              console.log(`[Observer] [ImageKit] Successfully updated ${filePath} with ImageKit URL`);
              
            } catch (error) {
              console.error(`[Observer] [ImageKit] Error updating file ${filePath}:`, error);
            }
          }
          
        } catch (error) {
          console.error(`[Observer] [ImageKit] Error processing screenshot for ${filePath}:`, error);
        }
      }
      
      console.log(`[Observer] [ImageKit] Finished processing screenshots for ${files.length} files in ${dirPath}`);
      
    } catch (error) {
      console.error(`[Observer] [ImageKit] Error accessing directory ${dirPath}:`, error);
    }
  }

  /**
   * Process all existing Markdown files in a directory
   * @param dirPath Relative path from content root (e.g., 'tooling/Enterprise Jobs-to-be-Done')
   */
  public async processExistingFiles(dirPath: string) {
    const dirConfig = this.directoryConfigs.find(c => 
      path.normalize(c.path) === path.normalize(dirPath)
    );
    
    if (!dirConfig) {
      console.error(`[Observer] No configuration found for directory: ${dirPath}`);
      return;
    }

    const fullPath = path.join(this.contentRoot, dirPath);
    
    try {
      // Check if directory exists
      await fs.promises.access(fullPath, fs.constants.R_OK);
      
      // Read all markdown files recursively
      const files: string[] = [];
      const readDir = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await readDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      };
      
      await readDir(fullPath);
      
      console.log(`[Observer] Found ${files.length} Markdown files in ${dirPath}`);
      
      // Process each file
      for (const filePath of files) {
        try {
          await this.onChange(filePath, dirConfig);
        } catch (error) {
          console.error(`[Observer] Error processing ${filePath}:`, error);
        }
      }
      
      console.log(`[Observer] Finished processing ${files.length} files in ${dirPath}`);
      
    } catch (error) {
      console.error(`[Observer] Error accessing directory ${dirPath}:`, error);
    }
  }

  public async startObserver(processExisting: boolean = false) {
    // Watch all configured directories
    for (const dirConfig of this.directoryConfigs) {
      const watchPath = path.join(this.contentRoot, dirConfig.path);
      
      // Process existing files if requested and configured
      if (processExisting && dirConfig.services?.imageKit?.processExistingFilesOnStart) {
        console.log(`[Observer] Processing screenshots for existing files in: ${watchPath}`);
        // Only process screenshots, not full OpenGraph fetching
        await this.processScreenshotsForExistingFiles(dirConfig.path);
      }
      
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
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');
      // Extract frontmatter (single source of truth)
      const originalFrontmatter = extractFrontmatter(fileContent);

      // === Delegate to IssueResolutionProcessor if applicable ===
      if (dirConfig.template === 'issue-resolution' && this.issueResolutionProcessor) {
        const result = await this.issueResolutionProcessor.processFile(filePath, originalFrontmatter, fileContent, dirConfig);
        
        if (result && result.needsWrite) {
          if (result.updatedFileContent) {
            await fs.promises.writeFile(filePath, result.updatedFileContent, 'utf8');
            console.log(`[Observer] File updated by IssueResolutionProcessor: ${filePath}`);
          } else if (result.updatedFrontmatter) {
            // Fallback if only frontmatter object is returned (should ideally be updatedFileContent)
            const { updateFrontmatter } = require('./utils/yamlFrontmatter'); // Ensure this utility is available
            const newContent = updateFrontmatter(fileContent, result.updatedFrontmatter);
            await fs.promises.writeFile(filePath, newContent, 'utf8');
            console.log(`[Observer] File updated (frontmatter only) by IssueResolutionProcessor: ${filePath}`);
          }
          // Reporting should ideally be handled within the processor or based on more specific results
          this.reportingService.logValidation(filePath, { 
            valid: true, 
            errors: [], 
            warnings: [] 
          });
          return; // Processing handled by IssueResolutionProcessor
        } else if (result && !result.needsWrite) {
          console.log(`[Observer] IssueResolutionProcessor reviewed, no changes needed: ${filePath}`);
          // Optionally log to reporting service that it was checked - using logValidation for consistency
          this.reportingService.logValidation(filePath, { 
            valid: true, // Assuming check implies no validation errors found by processor
            errors: [], 
            warnings: [{field: '_file', message: 'Checked by IssueResolutionProcessor, no changes.'}] // Example warning
          });
          return; // Processing (check) handled
        }
      }

      // If not handled by IssueResolutionProcessor, or if it returned null (error/not applicable),
      // proceed with generic observer logic. 
      // The original code had a return if !originalFrontmatter, so we might want to reinstate that
      // if specific processors are not expected to handle frontmatter creation from scratch.
      if (!originalFrontmatter) {
        console.log(`[Observer] No frontmatter found in ${filePath} and not handled by a specific processor.`);
        // Potentially report this as an issue or log for files that *should* have frontmatter
        // Corrected ReportingService call (formerly logError)
        this.reportingService.logValidation(filePath, { 
          valid: false, 
          errors: [{ field: 'frontmatter', message: 'No frontmatter found and no specific processor handled creation.', value: null }], 
          warnings: [] 
        });
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
        // Update date_modified first, ensuring YYYY-MM-DD format via formatDate
        propertyCollector.results.date_modified = formatDate(new Date());
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
   * Set up and start the ConceptsWatcher alongside the main observer.
   * This ensures that files in the concepts directory are properly processed
   * according to the concepts template configuration.
   * 
   * Aggressive comments: The ConceptsWatcher is a specialized watcher that handles
   * concepts-specific processing and validation. It works in parallel with the main
   * observer to ensure that concept files are properly processed.
   */
  public startConceptsWatcher() {
    // Find the concepts directory configuration from USER_OPTIONS
    const conceptsDirConfig = this.directoryConfigs.find(d => d.template === 'concepts');
    
    if (!conceptsDirConfig) {
      console.warn('[Observer] Concepts directory configuration not found in USER_OPTIONS. ConceptsWatcher not started.');
      return;
    }
    
    // Get the full path to the concepts directory
    const conceptsDir = path.join(this.contentRoot, conceptsDirConfig.path);
    
    // Verify the directory exists
    if (!fs.existsSync(conceptsDir)) {
      console.warn(`[Observer] Concepts directory not found at ${conceptsDir}. ConceptsWatcher not started.`);
      return;
    }
    
    console.log(`[Observer] Starting ConceptsWatcher for directory: ${conceptsDir}`);
    
    // Instantiate and start the ConceptsWatcher with the concepts directory path
    // Now using the centralized processed files tracker instead of callbacks
    this.conceptsWatcher = new ConceptsWatcher(
      this.reportingService, 
      conceptsDir
    );
    this.conceptsWatcher.start();
    
    console.log('[Observer] ConceptsWatcher started successfully.');
  }

  /**
   * Stop the ConceptsWatcher if running.
   */
  public stopConceptsWatcher() {
    if (this.conceptsWatcher) {
      this.conceptsWatcher.stop();
      this.conceptsWatcher = null;
      console.log('[Observer] ConceptsWatcher stopped.');
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
   * Set up and start the ToolingWatcher alongside the main observer.
   * This ensures that files in the tooling directory are properly processed
   * according to the tooling template configuration.
   */
  public startToolingWatcher(): void {
    if (this.toolingWatcher) {
      console.log('[Observer] ToolingWatcher is already running.');
      return;
    }

    // Find the specific configuration for the 'tooling/Enterprise Jobs-to-be-Done' path
    // This path is hardcoded for now as per the user's request for a specific watcher path.
    const specificToolingPathIdentifier = 'tooling/Enterprise Jobs-to-be-Done';
    const toolingDirConfig = USER_OPTIONS.directories.find(
      (dir) => dir.path === specificToolingPathIdentifier
    );

    if (!toolingDirConfig) {
      console.warn(`[Observer] No configuration found in USER_OPTIONS.directories for path: '${specificToolingPathIdentifier}'. ToolingWatcher will not be started for this specific path.`);
      // Optionally, you could decide to start it on the generic 'content/tooling' or not start it at all.
      // For this specific request, if the exact path config isn't found, we won't start the watcher.
      return; 
    }

    // Construct the absolute path for the ToolingWatcher
    const absoluteToolingWatchPath = path.join(this.contentRoot, toolingDirConfig.path);

    console.log(`[Observer] Initializing ToolingWatcher for specific path: ${absoluteToolingWatchPath}...`);
    this.toolingWatcher = new ToolingWatcher(
      absoluteToolingWatchPath, 
      this.reportingService,
      this.templateRegistry
    );
    this.toolingWatcher.start();
    
    console.log('[Observer] ToolingWatcher started successfully for specific path.');
  }

  /**
   * Stop the ToolingWatcher if running.
   */
  public stopToolingWatcher(): void {
    if (this.toolingWatcher) {
      this.toolingWatcher.stop();
      this.toolingWatcher = null;
      console.log('[Observer] ToolingWatcher stopped.');
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
      let pendingPromises = 0;
      try {
        // Cast process to any to access internal methods
        const nodeProcess = process as any;
        const activeHandles = nodeProcess._getActiveHandles?.() || [];
        const activeRequests = nodeProcess._getActiveRequests?.() || [];
        pendingPromises = activeHandles.length + activeRequests.length;
      } catch (error) {
        console.warn('[Observer] Unable to inspect process for active handles:', error);
      }
      
      if (this.reportingService) {
        this.reportingService.logShutdownDiagnostic(`Pending operations at shutdown: ${pendingPromises}`);
      }

      // Stop all specialized watchers
      if (this.remindersWatcher) {
        this.stopRemindersWatcher();
      }
      
      if (this.vocabularyWatcher) {
        this.stopVocabularyWatcher();
      }
      
      if (this.conceptsWatcher) {
        this.stopConceptsWatcher();
      }
      
      if (this.essaysWatcher) {
        this.stopEssaysWatcher();
      }
      
      if (this.toolingWatcher) {
        this.stopToolingWatcher();
      }
      
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
      try {
        // Clean up ImageKitService if it was initialized
        if (this.imageKitService) {
          try {
            console.log('[Observer] Shutting down ImageKitService...');
            await this.imageKitService.shutdown();
            console.log('[Observer] ImageKitService shutdown complete');
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[Observer] Error during ImageKitService shutdown:', errorMessage);
            if (this.reportingService) {
              this.reportingService.logShutdownDiagnostic(`Error during ImageKitService shutdown: ${errorMessage}`);
            }
          }
        }
      } finally {
        // CRITICAL: Explicitly shut down the processed files tracker before exiting
        // This ensures that when the process is restarted, it starts with a clean slate
        console.log('[Observer] Shutting down processed files tracker');
        await shutdownProcessedFilesTracker();
        
        console.log('[Observer] Exiting in 250ms...');
        setTimeout(() => {
          console.log('[Observer] Process exit now.');
          process.exit(0);
        }, 250);
      }
    }
  }
}
