// tidyverse/observers/watchers/issueResolutionWatcher.ts

import { TemplateRegistry } from '../services/templateRegistry';
import { ReportingService } from '../services/reportingService';
import { DirectoryConfig, USER_OPTIONS } from '../userOptionsConfig'; // Assuming DirectoryConfig is exported
import { updateFrontmatter, applyTemplateToFrontmatter } from '../utils/yamlFrontmatter';
import * as fs from 'fs';
import * as path from 'path';
import { issueResolutionTemplate } from '../templates/issue-resolution'; // Corrected import path

/**
 * IssueResolutionProcessor
 * 
 * This class is responsible for processing files within the 'issue-resolution' collection.
 * It does not initialize its own file watcher (chokidar) but is called by the
 * FileSystemObserver when a relevant file event occurs.
 *
 * Key Responsibilities:
 * 1. Validating existing frontmatter against the issue-resolution.ts template.
 * 2. Creating frontmatter from the template if it's missing.
 * 3. Applying default values and ensuring required fields are present.
 * 4. Integrating with handlers like addSiteUUID.
 * 5. Returning updated frontmatter and/or file content for the FileSystemObserver to write.
 */
export class IssueResolutionProcessor {
  private templateRegistry: TemplateRegistry;
  private reportingService: ReportingService;

  constructor(templateRegistry: TemplateRegistry, reportingService: ReportingService) {
    this.templateRegistry = templateRegistry;
    this.reportingService = reportingService;
    console.log('[IssueResolutionProcessor] Initialized');
  }

  /**
   * Processes a file from the 'issue-resolution' collection.
   *
   * @param filePath - Absolute path to the changed Markdown file.
   * @param originalFrontmatter - The already extracted frontmatter (or null if none/error).
   * @param fileContent - The full original content of the file.
   * @param dirConfig - The DirectoryConfig for 'issue-resolution' from userOptionsConfig.ts.
   * @returns A Promise resolving to an object indicating if changes were made and what those changes are,
   *          or null if an error occurs or no processing is applicable.
   */
  public async processFile(
    filePath: string,
    originalFrontmatter: Record<string, any> | null,
    fileContent: string,
    dirConfig: DirectoryConfig
  ): Promise<{ updatedFrontmatter?: Record<string, any>; updatedFileContent?: string; needsWrite: boolean } | null> {
    console.log(`[IssueResolutionProcessor] Processing file: ${filePath}`);

    // Ensure the template is registered (though it's imported directly here for now)
    // const template = this.templateRegistry.getTemplate(dirConfig.template);
    const template = issueResolutionTemplate; // Using direct import

    if (!template) {
      console.error(`[IssueResolutionProcessor] Template '${dirConfig.template}' not found for ${filePath}.`);
      this.reportingService.logValidation(filePath, { 
        valid: false, 
        errors: [{ field: 'template', message: `Template '${dirConfig.template}' not found for ${filePath}.`, value: dirConfig.template }], 
        warnings: [] 
      });
      return { needsWrite: false }; 
    }

    let currentFrontmatter = originalFrontmatter ? { ...originalFrontmatter } : {};
    let frontmatterModified = false;

    // Step 1: Apply template (create if missing, validate/default if existing)
    const { frontmatter: templatedFrontmatter, modified: templatedModified } = applyTemplateToFrontmatter(
      currentFrontmatter,
      template,
      USER_OPTIONS.AUTO_ADD_MISSING_FRONTMATTER_FIELDS !== undefined 
        ? USER_OPTIONS.AUTO_ADD_MISSING_FRONTMATTER_FIELDS 
        : true, // Default to true if not specified
      filePath // Pass filePath for defaultValueFn
    );
    currentFrontmatter = templatedFrontmatter;
    if (templatedModified) {
      frontmatterModified = true;
    }

    // If any modifications were made, prepare the updated file content
    if (frontmatterModified) {
      console.log(`[IssueResolutionProcessor] Frontmatter changes detected for ${filePath}. Preparing to update.`);
      // Use updateFrontmatter to preserve comments and existing content body
      const updatedFileContent = updateFrontmatter(fileContent, currentFrontmatter);
      
      // Log validation success (assuming modifications imply successful processing for now)
      this.reportingService.logValidation(filePath, {
        valid: true,
        errors: [], // No errors if processing was successful
        warnings: [] // Add warnings if any were generated during processing
        // frontmatter: currentFrontmatter, // Not a direct property of ValidationResult
      });

      return {
        updatedFrontmatter: currentFrontmatter, // For FileSystemObserver if it prefers the FM object
        updatedFileContent: updatedFileContent, // For FileSystemObserver to write directly
        needsWrite: true,
      };
    } else {
      console.log(`[IssueResolutionProcessor] No frontmatter modifications needed for ${filePath}`);
      // Optionally, still log that it was checked, even if not modified
      this.reportingService.logValidation(filePath, {
        valid: true, // Or determine based on actual validation status if no changes were made
        errors: [],
        warnings: [] // Could add a warning like { field: 'file', message: 'Checked, no changes required.'}
        // frontmatter: currentFrontmatter, // Not a direct property of ValidationResult
      });
      return { needsWrite: false };
    }
  }
}
