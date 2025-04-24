/**
 * Vocabulary Directory Watcher
 *
 * Watches the content/vocabulary directory for Markdown file changes.
 * Applies the 'vocabulary' template to new or changed files, ensuring frontmatter validity.
 * Modular, single-purpose watcher: does not handle other directories or templates.
 *
 * Aggressively commented per project standards.
 */

import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TemplateRegistry } from '../services/templateRegistry';
import { formatFrontmatter, extractFrontmatter, updateFrontmatter } from '../utils/yamlFrontmatter';
import vocabularyTemplate from '../templates/vocabulary';
import { TemplateField } from '../types/template';
import { ReportingService } from '../services/reportingService';

// === TemplateRegistry Instance (still needed for validation, etc.) ===
const templateRegistry = new TemplateRegistry();

// === Validate that the imported template matches the registry ===
// (Optional: could cross-check ids, but not strictly required)

/**
 * Watcher class for vocabulary directory
 * - Watches for .md file changes/creation
 * - Validates and updates frontmatter as needed
 */
export class VocabularyWatcher {
  private watcher: chokidar.FSWatcher;
  // ---------------------------------------------------------------------------
  // Aggressive Commenting: ReportingService is injected for logging validation
  private reportingService: ReportingService;
  // Directory to watch - now passed in via constructor
  private vocabularyDir: string;
  // Callbacks for file processing status tracking
  private markFileAsProcessed: (filePath: string) => void;
  private hasFileBeenProcessed: (filePath: string) => boolean;

  // ---------------------------------------------------------------------------
  /**
   * Construct a VocabularyWatcher
   * @param reportingService - ReportingService instance for logging validation results
   * @param vocabularyDir - Full path to the vocabulary directory to watch
   * @param markFileAsProcessed - Callback to mark a file as processed in the main observer
   * @param hasFileBeenProcessed - Callback to check if a file has been processed in the main observer
   */
  constructor(
    reportingService: ReportingService, 
    vocabularyDir: string,
    markFileAsProcessed: (filePath: string) => void,
    hasFileBeenProcessed: (filePath: string) => boolean
  ) {
    // Aggressive Commenting: Set up chokidar watcher for Markdown files in vocabulary directory only
    this.reportingService = reportingService;
    this.vocabularyDir = vocabularyDir;
    this.markFileAsProcessed = markFileAsProcessed;
    this.hasFileBeenProcessed = hasFileBeenProcessed;
    
    console.log(`[VocabularyWatcher] Initializing watcher for directory: ${this.vocabularyDir}`);
    
    this.watcher = chokidar.watch(path.join(this.vocabularyDir, '**/*.md'), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
    });
    this.setupEventHandlers();
  }

  /**
   * Set up file event handlers for add/change
   */
  private setupEventHandlers() {
    // Aggressive comment: Only handle add/change events, not unlink
    this.watcher.on('add', filePath => this.handleFile(filePath, 'add'));
    this.watcher.on('change', filePath => this.handleFile(filePath, 'change'));
  }

  /**
   * Handle file add/change event
   * @param filePath Absolute path to the file
   * @param eventType 'add' or 'change'
   */
  private async handleFile(filePath: string, eventType: string) {
    // === CRITICAL: Prevent infinite loop by skipping files already processed in this session ===
    if (this.hasFileBeenProcessed(filePath)) {
      console.log(`[VocabularyWatcher] [SKIP] File already processed in this session, skipping: ${filePath}`);
      return;
    }
    
    // Add file to processed set to prevent future processing in this session
    this.markFileAsProcessed(filePath);
    
    try {
      // Aggressive log: Entry
      console.log(`[VocabularyWatcher] [${eventType}] Detected: ${filePath}`);
      
      // Read file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Extract frontmatter (single source of truth)
      const originalFrontmatter = extractFrontmatter(content);
      if (!originalFrontmatter) {
        // Warn if no valid frontmatter found
        console.warn(`[VocabularyWatcher] No valid frontmatter found in ${filePath}`);
        return;
      }
      
      // === Property Collector Pattern ===
      // Only collect properties that need to be changed, don't modify original
      const propertyCollector: Record<string, any> = {};
      let changed = false;

      // === Validate and add missing fields ===
      for (const [key, fieldRaw] of Object.entries(vocabularyTemplate.required)) {
        const field = fieldRaw as TemplateField;
        if (!(key in originalFrontmatter) || originalFrontmatter[key] === '' || originalFrontmatter[key] === undefined) {
          propertyCollector[key] =
            typeof field.defaultValueFn === 'function'
              ? field.defaultValueFn(filePath)
              : field.defaultValue !== undefined
                ? field.defaultValue
                : '';
          changed = true;
          console.log(`[VocabularyWatcher] Added/filled missing field '${key}' in ${filePath}`);
        }
      }

      // === If changed, update file ===
      if (changed) {
        // Update date_modified
        propertyCollector.date_modified = new Date().toISOString();
        
        // Merge: overlay the collector on the original frontmatter
        const updatedFrontmatter = { ...originalFrontmatter, ...propertyCollector };
        
        // Write the updated frontmatter to file
        const newContent = updateFrontmatter(content, updatedFrontmatter);
        await fs.writeFile(filePath, newContent, 'utf8');
        
        console.log(`[VocabularyWatcher] Updated frontmatter written to: ${filePath}`);
        
        // === Register file as processed for reportingService ===
        this.reportingService.logValidation(filePath, { valid: true, errors: [], warnings: [] });
      } else {
        console.log(`[VocabularyWatcher] No frontmatter changes needed for: ${filePath}`);
      }
    } catch (err) {
      console.error(`[VocabularyWatcher] ERROR processing ${filePath}:`, err);
    }
  }

  /**
   * Start watching
   */
  public start() {
    console.log(`[VocabularyWatcher] Started watching: ${this.vocabularyDir}`);
  }

  /**
   * Stop watching
   */
  public stop() {
    this.watcher.close();
    console.log('[VocabularyWatcher] Stopped watching for file changes');
  }
}