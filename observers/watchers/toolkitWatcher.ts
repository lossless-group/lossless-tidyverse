import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';
import * as path from 'path';
import toolingTemplate from '../templates/tooling';
import { 
  extractFrontmatter, 
  writeFrontmatterToFile, 
  hasFrontmatter,
  formatFrontmatter, 
  extractBodyContent 
} from '../utils/yamlFrontmatter';
import { getCurrentDate } from '../utils/commonUtils';
import { ReportingService } from '../services/reportingService';
import { TemplateRegistry } from '../services/templateRegistry';

const TOOLING_COLLECTION_PATH_SEGMENT = 'tooling'; // Relative to content root

// --- Main Class Definition ---
export class ToolingWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private toolingCollectionPath: string;
  private reportingService: ReportingService;
  private templateRegistry: TemplateRegistry;

  constructor(
    specificWatchPath: string,
    reportingService: ReportingService,
    templateRegistry: TemplateRegistry
  ) {
    this.toolingCollectionPath = specificWatchPath;
    this.reportingService = reportingService;
    this.templateRegistry = templateRegistry;
    console.log(`[ToolingWatcher] Initialized to watch specific path: ${this.toolingCollectionPath}. TemplateRegistry received.`);
  }

  public start(): void {
    if (this.watcher) {
      console.log('[ToolingWatcher] Watcher is already running.');
      return;
    }

    console.log(`[ToolingWatcher] Starting watcher for directory: ${this.toolingCollectionPath}`);
    this.watcher = chokidar.watch(this.toolingCollectionPath, {
      persistent: true,
      ignoreInitial: true,
      ignored: /(^|[/\\])\.|\.DS_Store/,
      depth: undefined, // Watch all subdirectories
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (filePath) => {
        if (path.extname(filePath) === '.md') {
          console.log(`[ToolingWatcher] File added: ${filePath}`);
          this.processFile(filePath, 'add');
        }
      })
      .on('change', (filePath) => {
        if (path.extname(filePath) === '.md') {
          console.log(`[ToolingWatcher] File changed: ${filePath}`);
          // Potentially different logic for change vs add, for now, same processing
          this.processFile(filePath, 'change'); 
        }
      })
      .on('unlink', (filePath) => {
        console.log(`[ToolingWatcher] File removed: ${filePath}`);
        // Handle file removal if necessary
      })
      .on('error', (error) => {
        console.error(`[ToolingWatcher] Watcher error: ${error}`);
      });

    console.log('[ToolingWatcher] Watcher started and listening for changes.');
  }

  public stop(): void {
    if (this.watcher) {
      this.watcher.close().then(() => console.log('[ToolingWatcher] Watcher stopped.'));
      this.watcher = null;
    } else {
      console.log('[ToolingWatcher] Watcher is not running.');
    }
  }

  // Renamed from processNewFile, made a method
  private async processFile(filePath: string, eventType: 'add' | 'change'): Promise<void> {
    console.log(`[ToolingWatcher] Processing ${eventType} event for file: ${filePath}`);
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');

      if (!hasFrontmatter(fileContent)) {
        console.log(`[ToolingWatcher] File ${filePath} does not contain frontmatter delimiters. Skipping.`);
        return;
      }

      const currentFrontmatter = extractFrontmatter(fileContent);
      const body = extractBodyContent(fileContent);

      if (currentFrontmatter === null) { 
        console.log(`[ToolingWatcher] Could not extract frontmatter from ${filePath} (returned null). Skipping.`);
        return;
      }

      console.log(`[ToolingWatcher] Evaluating frontmatter for: ${filePath}`);
      console.log('[ToolingWatcher] Current Frontmatter:', JSON.stringify(currentFrontmatter, null, 2));
      // console.log('[ToolingWatcher] Body Content:', body.substring(0, 100) + '...'); // Optional: log snippet of body

      const propertyCollector: Record<string, any> = {};

      // Ensure the template is correctly identified and used
      const templateToUse = this.templateRegistry.findTemplate(filePath) || toolingTemplate; 

      console.log('\n[ToolingWatcher] --- Evaluating Required Fields ---');
      for (const fieldName in templateToUse.required) {
        const fieldDef = templateToUse.required[fieldName];
        const currentValue = currentFrontmatter[fieldName];
        let inspectionResult = { status: 'ok', message: 'Field present and valid' };

        if (fieldDef.inspection) {
          inspectionResult = fieldDef.inspection(currentValue, filePath, currentFrontmatter);
        }

        const resultLog = {
          field: fieldName,
          status: inspectionResult.status,
          message: inspectionResult.message,
          currentValue: currentValue === undefined ? 'undefined' : JSON.stringify(currentValue),
        };

        if (inspectionResult.status === 'missing' && fieldDef.defaultValueFn) {
          const defaultValue = fieldDef.defaultValueFn(filePath, currentFrontmatter);
          propertyCollector[fieldName] = defaultValue;
          console.log(`  - ${fieldName}: ${inspectionResult.status} - ${inspectionResult.message}. Current: ${resultLog.currentValue}. Proposed Default: ${JSON.stringify(defaultValue)} (to be collected)`);
        } else {
          console.log(`  - ${fieldName}: ${inspectionResult.status} - ${inspectionResult.message}. Current: ${resultLog.currentValue}`);
        }
      }

      console.log('\n[ToolingWatcher] --- Evaluating Optional Fields ---');
      for (const fieldName in templateToUse.optional) {
        const fieldDef = templateToUse.optional[fieldName];
        const currentValue = currentFrontmatter[fieldName];
        let inspectionResult = { status: 'ok', message: 'Field present or not applicable' };

        if (fieldDef.inspection) {
          inspectionResult = fieldDef.inspection(currentValue, filePath, currentFrontmatter);
        }
        
        const resultLog = {
          field: fieldName,
          status: inspectionResult.status,
          message: inspectionResult.message,
          currentValue: currentValue === undefined ? 'undefined' : JSON.stringify(currentValue),
        };

        if (inspectionResult.status !== 'ok' && fieldDef.defaultValueFn && currentValue === undefined) {
          const defaultValue = fieldDef.defaultValueFn(filePath, currentFrontmatter);
          propertyCollector[fieldName] = defaultValue;
          console.log(`  - ${fieldName}: ${inspectionResult.status} - ${inspectionResult.message}. Current: ${resultLog.currentValue}. Proposed Default (if applicable): ${JSON.stringify(defaultValue)} (to be collected)`);
        } else {
          console.log(`  - ${fieldName}: ${inspectionResult.status} - ${inspectionResult.message}. Current: ${resultLog.currentValue}`);
        }
      }

      // --- Handle date_modified after other properties are collected --- 
      const dateModifiedFieldDef = templateToUse.required.date_modified || templateToUse.optional.date_modified;
      if (dateModifiedFieldDef) { // Only if date_modified is defined in the template
        const otherRelevantChangesExist = Object.keys(propertyCollector).some(k => k !== 'date_modified');
        const needsAdding = !currentFrontmatter.hasOwnProperty('date_modified');

        if (otherRelevantChangesExist || needsAdding) {
          const newDateModified = getCurrentDate();
          // Update if: 
          // 1. date_modified isn't already in propertyCollector with the exact same new value (e.g., from its own template rule)
          // OR
          // 2. The newDateModified is different from the existing currentFrontmatter.date_modified or it was initially missing.
          if ((!propertyCollector.hasOwnProperty('date_modified') || propertyCollector.date_modified !== newDateModified) && 
              (currentFrontmatter.date_modified !== newDateModified || needsAdding)) {
            propertyCollector.date_modified = newDateModified;
            if (needsAdding) {
              console.log(`  - date_modified: Added ${newDateModified} (was missing and other changes occurred or is a defined field).`);
            } else {
              console.log(`  - date_modified: Updated to ${newDateModified} (due to other changes).`);
            }
          }
        }
      }

      // --- Write to file only if there are accumulated changes --- 
      if (Object.keys(propertyCollector).length > 0) {
        console.log('\n[ToolingWatcher] Changes were collected.');
        
        const proposedFrontmatter = { ...currentFrontmatter, ...propertyCollector };
        console.log('\n[ToolingWatcher] Proposed Frontmatter (if changes were applied):');
        console.log(JSON.stringify(proposedFrontmatter, null, 2));

        try {
          // Pass undefined for templateOrder as it's not directly on MetadataTemplate type
          // TODO: Consider defining and exporting a templateOrder from tooling.ts if specific order is needed
          await writeFrontmatterToFile(filePath, proposedFrontmatter, undefined, this.reportingService);
          console.log(`[ToolingWatcher] Successfully updated frontmatter for ${filePath}`);
        } catch (error) {
          console.error(`[ToolingWatcher] Error writing frontmatter to file ${filePath}:`, error);
        }

      } else {
        console.log('\n[ToolingWatcher] No changes proposed based on template evaluation.');
      }

      console.log(`\n[ToolingWatcher] Evaluation complete for: ${filePath}`);
      // Report success to ReportingService
      // Log validation even if no changes, to signify successful processing of the file structure itself.
      this.reportingService.logValidation(filePath, { valid: true, errors: [], warnings: [] });
      console.log(`[ToolingWatcher] Reported successful processing for ${filePath} to ReportingService.`);

    } catch (error) {
      console.error(`[ToolingWatcher] Error processing file ${filePath}:`, error);
      // Report failure to ReportingService
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportingService.logValidation(filePath, { 
        valid: false, 
        errors: [{ field: 'general', message: `Processing error: ${errorMessage}`, value: filePath }], 
        warnings: [] 
      });
      console.log(`[ToolingWatcher] Reported processing error for ${filePath} to ReportingService.`);
    }
  }
}