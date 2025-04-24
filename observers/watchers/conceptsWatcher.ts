/**
 * Concepts Directory Watcher
 *
 * Watches the content/concepts directory for Markdown file changes.
 * Applies the 'concepts' template to new or changed files, ensuring frontmatter validity.
 * Modular, single-purpose watcher: does not handle other directories or templates.
 *
 * Aggressively commented per project standards.
 */

import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TemplateRegistry } from '../services/templateRegistry';
import { formatFrontmatter, extractFrontmatter, updateFrontmatter } from '../utils/yamlFrontmatter';
import conceptsTemplate from '../templates/concepts';
import { TemplateField } from '../types/template';
import { ReportingService } from '../services/reportingService';
// Import the centralized processed files tracker
import { markFileAsProcessed, shouldProcessFile } from '../utils/processedFilesTracker';

// === TemplateRegistry Instance (still needed for validation, etc.) ===
const templateRegistry = new TemplateRegistry();

// === Validate that the imported template matches the registry ===
// (Optional: could cross-check ids, but not strictly required)

/**
 * Watcher class for concepts directory
 * - Watches for .md file changes/creation
 * - Validates and updates frontmatter as needed
 */
export class ConceptsWatcher {
  private watcher: chokidar.FSWatcher;
  // ---------------------------------------------------------------------------
  // Aggressive Commenting: ReportingService is injected for logging validation
  private reportingService: ReportingService;
  // Directory to watch - now passed in via constructor
  private conceptsDir: string;

  // ---------------------------------------------------------------------------
  /**
   * Construct a ConceptsWatcher
   * @param reportingService - ReportingService instance for logging validation results
   * @param conceptsDir - Full path to the concepts directory to watch
   */
  constructor(
    reportingService: ReportingService, 
    conceptsDir: string
  ) {
    // Aggressive Commenting: Set up chokidar watcher for Markdown files in concepts directory only
    this.reportingService = reportingService;
    this.conceptsDir = conceptsDir;
    
    console.log(`[ConceptsWatcher] Initializing watcher for directory: ${this.conceptsDir}`);
    
    this.watcher = chokidar.watch(path.join(this.conceptsDir, '**/*.md'), {
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
      console.log(`[ConceptsWatcher] [SKIP] File already processed in this session, skipping: ${filePath}`);
      return;
    }
    
    // Skip test files
    if (filePath.toLowerCase().includes('test')) {
      console.log(`[ConceptsWatcher] [SKIP] Skipping test file: ${filePath}`);
      return;
    }
    
    // Add file to processed set to prevent future processing in this session
    markFileAsProcessed(filePath);
    
    try {
      // Aggressive log: Entry
      console.log(`[ConceptsWatcher] [${eventType}] Detected: ${filePath}`);
      
      // Read file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Extract frontmatter (single source of truth)
      const originalFrontmatter = extractFrontmatter(content);
      
      // If no frontmatter, create it from template
      if (!originalFrontmatter) {
        console.log(`[ConceptsWatcher] No frontmatter found in ${filePath}, creating from template`);
        
        // === Property Collector Pattern ===
        // Only collect properties that need to be changed, don't modify original
        const propertyCollector: Record<string, any> = {};
        
        // === Add all required fields from template ===
        for (const [key, fieldRaw] of Object.entries(conceptsTemplate.required)) {
          const field = fieldRaw as TemplateField;
          // Use the template's defaultValueFn to get the value
          propertyCollector[key] = typeof field.defaultValueFn === 'function'
            ? field.defaultValueFn(filePath, {})
            : field.defaultValue !== undefined
              ? field.defaultValue
              : '';
        }
        
        // Format frontmatter and update file
        const frontmatterYaml = formatFrontmatter(propertyCollector);
        const newContent = `---\n${frontmatterYaml}---\n\n${content}`;
        await fs.writeFile(filePath, newContent, 'utf8');
        
        console.log(`[ConceptsWatcher] Created frontmatter for: ${filePath}`);
        
        // Register file as processed for reportingService
        this.reportingService.logValidation(filePath, { valid: true, errors: [], warnings: [] });
        return;
      }
      
      // If frontmatter exists, check if it needs updating
      if (originalFrontmatter) {
        // Make a copy of the frontmatter for updates
        const updatedFrontmatter: Record<string, any> = originalFrontmatter ? { ...originalFrontmatter } : {};
        
        // === Property Collector Pattern ===
        // Only collect properties that need to be changed, don't modify original
        const propertyCollector: Record<string, any> = {};
        let changed = false;
        
        // === Check and update required fields ===
        for (const [key, fieldRaw] of Object.entries(conceptsTemplate.required)) {
          const field = fieldRaw as TemplateField;
          // Only add/update field if it's missing or empty
          if (!(key in updatedFrontmatter) || updatedFrontmatter[key] === '' || updatedFrontmatter[key] === undefined) {
            // Use the template's defaultValueFn to get the value
            propertyCollector[key] = typeof field.defaultValueFn === 'function'
              ? field.defaultValueFn(filePath, updatedFrontmatter)
              : field.defaultValue !== undefined
                ? field.defaultValue
                : '';
            changed = true;
            console.log(`[ConceptsWatcher] Added/updated field '${key}' in ${filePath}`);
          }
        }
        
        // Only update date_modified if we made changes
        if (changed) {
          // Use the template's logic for date_modified if available
          const dateModifiedField = conceptsTemplate.required.date_modified as TemplateField;
          if (dateModifiedField && typeof dateModifiedField.defaultValueFn === 'function') {
            propertyCollector.date_modified = dateModifiedField.defaultValueFn(filePath, updatedFrontmatter);
          }
          
          // Merge: overlay the collector on the original frontmatter
          const mergedFrontmatter = { ...updatedFrontmatter, ...propertyCollector };
          
          // Write the updated frontmatter to file
          const frontmatterYaml = formatFrontmatter(mergedFrontmatter);
          const newContent = `---\n${frontmatterYaml}---\n\n${content.replace(/^---[\s\S]*?---\s*/, '')}`;
          await fs.writeFile(filePath, newContent, 'utf8');
          
          console.log(`[ConceptsWatcher] Updated frontmatter written to: ${filePath}`);
          console.log(`[ConceptsWatcher] Changes made:\n${JSON.stringify(propertyCollector, null, 2)}`);
          
          // Register file as processed for reportingService
          this.reportingService.logValidation(filePath, { valid: true, errors: [], warnings: [] });
        } else {
          console.log(`[ConceptsWatcher] No frontmatter changes needed for: ${filePath}`);
        }
        return;
      }
      
      // === Property Collector Pattern ===
      // Only collect properties that need to be changed, don't modify original
      const propertyCollector: Record<string, any> = {};
      let changed = false;

      // === Validate and add missing fields ===
      for (const [key, fieldRaw] of Object.entries(conceptsTemplate.required)) {
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
          console.log(`[ConceptsWatcher] Added/updated field '${key}' in ${filePath}`);
        }
      }

      // === If changed, update file ===
      if (changed) {
        // Update date_modified
        propertyCollector.date_modified = new Date().toISOString();
        
        // Merge: overlay the collector on the original frontmatter
        let updatedFrontmatter: Record<string, any>;
        if (originalFrontmatter) {
          // Use type assertion to tell TypeScript that originalFrontmatter is a Record<string, any>
          updatedFrontmatter = { ...(originalFrontmatter as Record<string, any>), ...propertyCollector };
        } else {
          updatedFrontmatter = { ...propertyCollector };
        }
        
        // Write the updated frontmatter to file
        const newContent = updateFrontmatter(content, updatedFrontmatter);
        await fs.writeFile(filePath, newContent, 'utf8');
        
        console.log(`[ConceptsWatcher] Updated frontmatter written to: ${filePath}`);
        
        // === Register file as processed for reportingService ===
        this.reportingService.logValidation(filePath, { valid: true, errors: [], warnings: [] });
      } else {
        console.log(`[ConceptsWatcher] No frontmatter changes needed for: ${filePath}`);
      }
    } catch (err) {
      console.error(`[ConceptsWatcher] ERROR processing ${filePath}:`, err);
    }
  }

  /**
   * Start watching
   */
  public start() {
    console.log(`[ConceptsWatcher] Started watching: ${this.conceptsDir}`);
  }

  /**
   * Stop watching
   */
  public stop() {
    this.watcher.close();
    console.log('[ConceptsWatcher] Stopped watching for file changes');
  }
}