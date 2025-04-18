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

// === Directory to Watch ===
const VOCABULARY_DIR = path.resolve(process.cwd(), 'content/vocabulary');

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
  constructor() {
    // === Aggressive Commenting ===
    // Set up chokidar watcher for Markdown files in vocabulary directory only
    this.watcher = chokidar.watch(path.join(VOCABULARY_DIR, '**/*.md'), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
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
    try {
      // Aggressive log: Entry
      console.log(`[VocabularyWatcher] [${eventType}] Detected: ${filePath}`);
      const content = await fs.readFile(filePath, 'utf8');
      const originalFrontmatter = extractFrontmatter(content);
      let updatedFrontmatter = originalFrontmatter ? { ...originalFrontmatter } : {};
      let changed = false;

      // === Validate and add missing fields ===
      for (const [key, fieldRaw] of Object.entries(vocabularyTemplate.required)) {
        const field = fieldRaw as TemplateField;
        if (!(key in updatedFrontmatter) || updatedFrontmatter[key] === '' || updatedFrontmatter[key] === undefined) {
          updatedFrontmatter[key] =
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
        const newContent = updateFrontmatter(content, updatedFrontmatter);
        await fs.writeFile(filePath, newContent, 'utf8');
        console.log(`[VocabularyWatcher] Updated frontmatter written to: ${filePath}`);
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
    console.log(`[VocabularyWatcher] Started watching: ${VOCABULARY_DIR}`);
  }

  /**
   * Stop watching
   */
  public stop() {
    this.watcher.close();
    console.log('[VocabularyWatcher] Stopped watching for file changes');
  }
}

// === Export a default instance for easy integration ===
export const vocabularyWatcher = new VocabularyWatcher();

// === Usage Example (to be toggled by User Options elsewhere) ===
// if (USER_OPTIONS.directories.find(d => d.template === 'vocabulary' && d.enabled)) {
//   vocabularyWatcher.start();
// }