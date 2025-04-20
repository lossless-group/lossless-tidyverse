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
        const { ogKeyValues } = await import('./services/openGraphService').then(mod => mod.processOpenGraphKeyValues(originalFrontmatter, filePath));
        if (ogKeyValues && Object.keys(ogKeyValues).length > 0) {
          Object.assign(propertyCollector.results, ogKeyValues);
          if (this.directoryConfig.services.logging?.openGraph) {
            console.log(`[Observer] [fetchOpenGraph] OpenGraph properties updated for ${filePath}:`, ogKeyValues);
          }
        }
        propertyCollector.expectations.expectOpenGraph = false;
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
}
