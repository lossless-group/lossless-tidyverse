// =============================================
// Three-argument Class-Based File System Observer
// Config-driven: uses USER_OPTIONS from userOptionsConfig.ts
// Watches for Markdown file changes and logs frontmatter
// =============================================

import chokidar from 'chokidar';
import { extractFrontmatter } from './utils/yamlFrontmatter';
import fs from 'fs';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';
// === IMPORT USER_OPTIONS CONFIG ===
import { USER_OPTIONS } from './userOptionsConfig';
import path from 'path';

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
   * Handler for file add/change events
   * Reads file, extracts, and logs frontmatter
   */
  private onChange(filePath: string) {
    if (!this.isMarkdownFile(filePath)) return;
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = extractFrontmatter(fileContent);
      console.log(`[Observer] Frontmatter for ${filePath}:`, frontmatter);
    } catch (err) {
      console.error(`[Observer] ERROR reading/extracting frontmatter from ${filePath}:`, err);
    }
  }
}
