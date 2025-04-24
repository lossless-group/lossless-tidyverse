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
// Import the centralized processed files tracker
import { markFileAsProcessed, shouldProcessFile } from '../utils/processedFilesTracker';

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

  // ---------------------------------------------------------------------------
  /**
   * Construct a VocabularyWatcher
   * @param reportingService - ReportingService instance for logging validation results
   * @param vocabularyDir - Full path to the vocabulary directory to watch
   */
  constructor(
    reportingService: ReportingService, 
    vocabularyDir: string
  ) {
    // Aggressive Commenting: Set up chokidar watcher for Markdown files in vocabulary directory only
    this.reportingService = reportingService;
    this.vocabularyDir = vocabularyDir;
    
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
    if (!shouldProcessFile(filePath)) {
      console.log(`[VocabularyWatcher] [SKIP] File already processed in this session, skipping: ${filePath}`);
      return;
    }
    
    // Skip test files
    if (filePath.toLowerCase().includes('test')) {
      console.log(`[VocabularyWatcher] [SKIP] Skipping test file: ${filePath}`);
      return;
    }
    
    // Add file to processed set to prevent future processing in this session
    markFileAsProcessed(filePath);
    
    try {
      // Aggressive log: Entry
      console.log(`[VocabularyWatcher] [${eventType}] Detected: ${filePath}`);
      
      // Read file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Extract frontmatter (single source of truth)
      const originalFrontmatter = extractFrontmatter(content);
      
      // CRITICAL: For newly added files, we should apply the template
      // Check if this is a new file (first time we're seeing it)
      const isNewFile = eventType === 'add';
      
      // If it's a new file OR there's no frontmatter, apply the template
      if (isNewFile || !originalFrontmatter) {
        console.log(`[VocabularyWatcher] ${!originalFrontmatter ? 'No frontmatter found' : 'New file detected'} in ${filePath} - applying template`);
        
        // Start with existing frontmatter or empty object
        const updatedFrontmatter: Record<string, any> = originalFrontmatter || {};
        
        // === Property Collector Pattern ===
        // Only collect properties that need to be changed, don't modify original
        const propertyCollector: Record<string, any> = {};
        let changed = false;

        // === Validate and add missing fields ===
        for (const [key, fieldRaw] of Object.entries(vocabularyTemplate.required)) {
          const field = fieldRaw as TemplateField;
          // Only add/update field if it's missing or empty
          if (!(key in updatedFrontmatter) || updatedFrontmatter[key] === '' || updatedFrontmatter[key] === undefined) {
            // Use the template's defaultValueFn to get the value - this is where the logic should be
            propertyCollector[key] = typeof field.defaultValueFn === 'function'
              ? field.defaultValueFn(filePath, updatedFrontmatter)
              : field.defaultValue !== undefined
                ? field.defaultValue
                : '';
            changed = true;
            console.log(`[VocabularyWatcher] Added/updated field '${key}' in ${filePath}`);
          }
        }
        
        // Only update date_modified if we made changes
        if (changed) {
          // Use the template's logic for date_modified if available
          const dateModifiedField = vocabularyTemplate.required.date_modified as TemplateField;
          if (dateModifiedField && typeof dateModifiedField.defaultValueFn === 'function') {
            propertyCollector.date_modified = dateModifiedField.defaultValueFn(filePath, updatedFrontmatter);
          }
          
          // Merge: overlay the collector on the original frontmatter
          const mergedFrontmatter = { ...updatedFrontmatter, ...propertyCollector };
          
          // Write the updated frontmatter to file
          const frontmatterYaml = formatFrontmatter(mergedFrontmatter);
          const newContent = `---\n${frontmatterYaml}---\n\n${content.replace(/^---[\s\S]*?---\s*/, '')}`;
          await fs.writeFile(filePath, newContent, 'utf8');
          
          console.log(`[VocabularyWatcher] Updated frontmatter written to: ${filePath}`);
          console.log(`[VocabularyWatcher] Changes made:\n${JSON.stringify(propertyCollector, null, 2)}`);
          
          // Register file as processed for reportingService
          this.reportingService.logValidation(filePath, { valid: true, errors: [], warnings: [] });
        } else {
          console.log(`[VocabularyWatcher] No frontmatter changes needed for: ${filePath}`);
        }
        return;
      }
      
      // === Property Collector Pattern ===
      // Only collect properties that need to be changed, don't modify original
      const propertyCollector: Record<string, any> = {};
      let changed = false;

      // === Validate and add missing fields ===
      for (const [key, fieldRaw] of Object.entries(vocabularyTemplate.required)) {
        const field = fieldRaw as TemplateField;
        // Only add/update field if it's missing or empty
        if (!(key in originalFrontmatter) || originalFrontmatter[key] === '' || originalFrontmatter[key] === undefined) {
          // Use the template's defaultValueFn to get the value - this is where the logic should be
          propertyCollector[key] = typeof field.defaultValueFn === 'function'
            ? field.defaultValueFn(filePath, originalFrontmatter)
            : field.defaultValue !== undefined
              ? field.defaultValue
              : '';
          changed = true;
          console.log(`[VocabularyWatcher] Added/updated field '${key}' in ${filePath}`);
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