// =============================================
// Three-argument Class-Based File System Observer
// Config-driven: uses USER_OPTIONS from userOptionsConfig.ts
// Watches for Markdown file changes and logs frontmatter
// =============================================

import chokidar from 'chokidar';
import { extractFrontmatter, writeFrontmatterToFile } from './utils/yamlFrontmatter';
import fs from 'fs';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';
// === IMPORT USER_OPTIONS CONFIG ===
import { USER_OPTIONS } from './userOptionsConfig';
import path from 'path';
// === Import addSiteUUID handler ===
import { addSiteUUID } from './handlers/addSiteUUID';

/**
 * FileSystemObserver
 * Watches a directory for Markdown (.md) file changes and logs frontmatter.
 * Uses config from USER_OPTIONS (userOptionsConfig.ts) for all directory/template/service logic.
 * For now, only the "tooling" config is used.
 */
export class FileSystemObserver {
  private contentRoot: string;
  private directoryConfig: typeof USER_OPTIONS.directories[0];

  /**
   * @param templateRegistry (unused, for compatibility)
   * @param reportingService (unused, for compatibility)
   * @param contentRoot Directory root (e.g., /Users/mpstaton/code/lossless-monorepo/content)
   */
  constructor(templateRegistry: TemplateRegistry, reportingService: ReportingService, contentRoot: string) {
    this.contentRoot = contentRoot;
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
   * Reads the file, extracts frontmatter, injects UUID if needed, and writes back if changed.
   * Aggressively, continuously commented per project rules.
   *
   * @param filePath - Path to the changed Markdown file
   */
  private async onChange(filePath: string) {
    // Only process Markdown files
    if (!this.isMarkdownFile(filePath)) return;
    try {
      // Read file content
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      // Extract frontmatter
      let frontmatter = extractFrontmatter(fileContent);
      if (frontmatter) {
        // === Inject UUID into frontmatter object ===
        frontmatter = addSiteUUID(frontmatter, filePath);
        // === Write updated frontmatter back to file ===
        // Aggressively commented: This persists any changes made by addSiteUUID
        await writeFrontmatterToFile(filePath, frontmatter);
        // === Log updated frontmatter ===
        console.log(`[Observer] Frontmatter for ${filePath}:`, frontmatter);
      } else {
        // Warn if no valid frontmatter found
        console.warn(`[Observer] No valid frontmatter found in ${filePath}`);
      }
    } catch (err) {
      // Log error if reading or writing fails
      console.error(`[Observer] ERROR reading/extracting/writing frontmatter from ${filePath}:`, err);
    }
  }
}
