/**
 * USER_OPTIONS
 * 
 * User-configurable options for the observer system.
 * - batchReportIntervalMinutes: Number of minutes between automatic batch report generations.
 *   This controls how often the observer will attempt to write a batch report if there are unreported changes.
 *   Change this value to set your preferred periodicity for batch reporting.
 */
// Removed from here, moved to reportingService.ts as requested.

/**
 * File System Observer
 * 
 * Watches for file changes in the content directory and applies frontmatter templates
 * to new files or validates existing frontmatter against templates.
 * 
 * This implementation uses chokidar to watch for file system events and applies
 * appropriate templates based on file paths.
 */

import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';
import { MetadataTemplate } from './types/template';
import { processOpenGraphMetadata } from './services/openGraphService';
import { processCitations } from './services/citationService';
import { formatDate } from './utils/commonUtils'; // Enforce single source of truth for date formatting
import { formatFrontmatter, extractFrontmatter, updateFrontmatter } from './utils/yamlFrontmatter';
import { reportingServiceUserOptions } from './services/reportingService';

// Import reportingServiceUserOptions as the single source of truth for batch report interval
// Use reportingServiceUserOptions.batchReportIntervalMinutes as the single source of truth for interval
const BATCH_REPORT_INTERVAL_MINUTES = reportingServiceUserOptions.batchReportIntervalMinutes;

// Example usage: replacing all date creation/formatting with formatDate
// (Below are example replacements; actual usage depends on where you need to create or update date fields)

// Instead of:
// const today = new Date();
// const dateString = today.toISOString().split('T')[0];
// Use:
// const dateString = formatDate(new Date());

// Instead of:
// dateCreated: new Date().toISOString(),
// Use:
// dateCreated: formatDate(new Date());

// Instead of:
// dateUpdated: new Date().toISOString(),
// Use:
// dateUpdated: formatDate(new Date());

// USER_OPTIONS: Directory-specific configuration for templates and services.
// Each entry specifies which template and services to use for a directory.
const USER_OPTIONS = {
  directories: [
    {
      path: 'tooling/Enterprise Jobs-to-be-Done',
      template: 'tooling', // matches a template id
      services: {
        openGraph: true,
        citations: false
      },
      operationSequence: [
        { op: 'addSiteUUID' },
        { op: 'updateDateModified' },
        { op: 'extractFrontmatter', delayMs: 25 },
        { op: 'fetchOpenGraph', delayMs: 25 },
        { op: 'updateDateModified', delayMs: 300 },
        { op: 'validateFrontmatter', delayMs: 25 }
      ]
    },
    {
      path: 'vocabulary',
      template: 'vocabulary',
      services: {
        openGraph: false,
        citations: true
      }
    },
    {
      path: 'lost-in-public/prompts',
      template: 'prompts',
      services: {
        openGraph: false,
        citations: false
      }
    },
    {
      path: 'specs',
      template: 'specifications',
      services: {
        openGraph: false,
        citations: false
      }
    }
    // Add more directory configs as needed
  ]
  // Add more global options as needed
};

// Modular Operation Handlers
// Each handler receives (frontmatter, filePath) and returns { frontmatter, changed }
const operationHandlers: Record<string, Function> = {
  async addSiteUUID(frontmatter: Record<string, any>, filePath: string) {
    // Add site_uuid if missing
    if (!frontmatter.site_uuid) {
      const { generateUUID } = await import('./utils/commonUtils');
      frontmatter.site_uuid = generateUUID();
      return { frontmatter, changed: true };
    }
    return { frontmatter, changed: false };
  },
  async updateDateModified(frontmatter: Record<string, any>, filePath: string) {
    // Always set date_modified to now
    const { formatDate } = await import('./utils/commonUtils');
    frontmatter.date_modified = formatDate(new Date());
    return { frontmatter, changed: true };
  },
  async extractFrontmatter(filePath: string) {
    // Re-extract frontmatter from file
    const { extractFrontmatter } = await import('./utils/yamlFrontmatter');
    const content = await fs.readFile(filePath, 'utf8');
    const { frontmatter } = extractFrontmatter(content) || {};
    return { frontmatter, changed: false };
  },
  async fetchOpenGraph(frontmatter: Record<string, any>, filePath: string) {
    // Pass to OpenGraph service, only write if changes
    // Use static import (see top of file)
    const ogResult = await processOpenGraphMetadata(frontmatter, filePath);
    if (ogResult && ogResult.changed && ogResult.updatedFrontmatter) {
      Object.assign(frontmatter, ogResult.updatedFrontmatter);
      return { frontmatter, changed: true };
    }
    return { frontmatter, changed: false };
  }
};

/**
 * Converts a string to Train-Case (first letter of each word capitalized, joined with hyphens)
 * @param str The string to convert
 * @returns The string in Train-Case
 */
function convertToTrainCase(str: string): string {
  if (!str) return '';
  
  // Replace underscores and spaces with hyphens
  let result = str.replace(/[_\s]+/g, '-');
  
  // Capitalize first letter of each word
  result = result.replace(/(^|\-)([a-z])/g, (match, separator, letter) => {
    return separator + letter.toUpperCase();
  });
  
  return result;
}

/**
 * Reports validation errors for a file
 * @param filePath The path to the file
 * @param validationResult The validation result
 * @param reportingService The reporting service to use
 */
function reportValidationErrors(
  filePath: string, 
  validationResult: any, 
  reportingService: ReportingService
): void {
  console.log(`Validation errors in ${filePath}:`);
  
  if (validationResult.errors && validationResult.errors.length > 0) {
    console.log('Errors:');
    for (const error of validationResult.errors) {
      console.log(`  - ${error}`);
    }
  }
  
  if (validationResult.warnings && validationResult.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of validationResult.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  
  // Log validation issues to the reporting service
  reportingService.logValidation(filePath, validationResult);
}

/**
 * Add missing required fields to frontmatter based on template
 * @param frontmatter The original frontmatter
 * @param template The template to apply
 * @param filePath The path to the file
 * @param reportingService The reporting service to use
 * @returns The updated frontmatter and whether it was changed
 */
async function addMissingRequiredFields(
  frontmatter: Record<string, any>,
  template: MetadataTemplate,
  filePath: string,
  reportingService: ReportingService
): Promise<{ updatedFrontmatter: Record<string, any>; changed: boolean }> {
  // Create a copy of the frontmatter to avoid modifying the original
  const updatedFrontmatter = { ...frontmatter };
  let changed = false;
  
  // Check for required fields
  if (template.required) {
    for (const [key, field] of Object.entries(template.required)) {
      // If the field is missing or null, add it with the default value or value from defaultValueFn
      if (updatedFrontmatter[key] === undefined || updatedFrontmatter[key] === null) {
        try {
          // If there's a defaultValueFn, use it to generate the value
          if (field.defaultValueFn) {
            const value = await field.defaultValueFn(filePath, updatedFrontmatter);
            
            if (value !== undefined) {
              updatedFrontmatter[key] = value;
              changed = true;
              
              // Log the field addition to the reporting service
              reportingService.logFieldAdded(filePath, key, value);
              
              console.log(`Added required field ${key} with value ${value} to ${filePath}`);
            }
          }
          // Otherwise, use the default value if provided
          else if (field.defaultValue !== undefined) {
            updatedFrontmatter[key] = field.defaultValue;
            changed = true;
            
            // Log the field addition to the reporting service
            reportingService.logFieldAdded(filePath, key, field.defaultValue);
            
            console.log(`Added required field ${key} with default value ${field.defaultValue} to ${filePath}`);
          }
        } catch (error) {
          console.error(`Error adding required field ${key} to ${filePath}:`, error);
        }
      }
    }
  }
  
  // --- BEGIN: Replace all date field assignments with formatDate ---
  // This edit ensures all date fields (dateCreated, dateUpdated, date_modified, etc.) use the formatDate utility as the single source of truth.
  // This includes: when adding missing required fields, updating frontmatter, and any file metadata updates.
  for (const key in updatedFrontmatter) {
    if (key === 'dateCreated' || key === 'dateUpdated' || key === 'date_modified' || key === 'date_created') {
      updatedFrontmatter[key] = formatDate(new Date());
    }
  }
  // --- END: Replace all date field assignments with formatDate ---
  
  return { updatedFrontmatter, changed };
}

/**
 * Validate and update frontmatter for a file using a template
 * @param filePath The path to the file
 * @param template The MetadataTemplate to use
 *
 * This method extracts the frontmatter, validates it against the template,
 * adds any missing required fields, and writes the updated frontmatter back if needed.
 *
 * WARNING: Minimal implementation. Refactor as needed for more advanced reporting or error handling.
 */
async function validateAndUpdateFrontmatter(
  filePath: string,
  template: MetadataTemplate,
  templateRegistry: TemplateRegistry,
  reportingService: ReportingService,
  frontmatter?: Record<string, any>
): Promise<void> {
  try {
    // Read file content
    const content = await fs.readFile(filePath, 'utf8');
    let frontmatterToUse = frontmatter;
    if (!frontmatterToUse) {
      frontmatterToUse = extractFrontmatter(content) || {};
    }

    // Validate frontmatter against template
    const validationResult = templateRegistry.validateAgainstTemplate(frontmatterToUse, template);
    if (!validationResult.valid) {
      reportValidationErrors(filePath, validationResult, reportingService);
    }

    // Add missing required fields
    const { updatedFrontmatter, changed } = await addMissingRequiredFields(
      frontmatterToUse,
      template,
      filePath,
      reportingService
    );

    if (changed) {
      const updatedContent = updateFrontmatter(content, updatedFrontmatter);
      await fs.writeFile(filePath, updatedContent, 'utf8');
      console.log(`Updated frontmatter for ${filePath}`);
    }
  } catch (error) {
    console.error(`Error validating/updating frontmatter for ${filePath}:`, error);
  }
}

/**
 * File System Observer class that watches for file changes and applies templates
 */
export class FileSystemObserver {
  private watcher: chokidar.FSWatcher;
  private templateRegistry: TemplateRegistry;
  private reportingService: ReportingService;
  private contentRoot: string;
  private processingFiles = new Set<string>();
  private recentlyModifiedByObserver = new Set<string>();
  private modificationCooldownPeriod = 5000; // 5 seconds
  private initialProcessingComplete = false;
  private processedFilesInInitialPhase: Set<string> | null = null;
  
  /**
   * Create a new FileSystemObserver
   * @param templateRegistry The template registry to use
   * @param reportingService The reporting service to use
   * @param contentRoot The root directory to watch
   * @param options Options for the observer
   */
  constructor(
    templateRegistry: TemplateRegistry,
    reportingService: ReportingService,
    contentRoot: string,
    private options: {
      ignoreInitial?: boolean;
      processExistingFiles?: boolean;
      initialProcessingDelay?: number; // Delay in ms before switching to regular observer mode
    } = {}
  ) {
    console.log(`Creating FileSystemObserver for ${contentRoot}`);
    
    this.templateRegistry = templateRegistry;
    this.reportingService = reportingService;
    this.contentRoot = contentRoot;
    
    // Set default options
    this.options.ignoreInitial = this.options.ignoreInitial ?? false;
    this.options.processExistingFiles = this.options.processExistingFiles ?? true;
    this.options.initialProcessingDelay = this.options.initialProcessingDelay ?? 90000; // Default 90 seconds
    
    // Set up the watcher with multiple directories
    this.watcher = chokidar.watch(
      USER_OPTIONS.directories.map(dir => path.join(contentRoot, dir.path)),
      {
        persistent: true,
        ignoreInitial: this.options.ignoreInitial,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100
        }
      }
    );
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Set up report generation
    this.setupReportGeneration();
    
    // Set up initial processing timeout
    if (this.options.processExistingFiles) {
      console.log(`Initial processing mode active. Will switch to regular observer mode after ${this.options.initialProcessingDelay / 1000} seconds.`);
      setTimeout(async () => {
        console.log('Switching to regular observer mode...');
        this.initialProcessingComplete = true;
        
        // Clear the processed files set when switching to regular mode
        if (this.processedFilesInInitialPhase) {
          console.log(`Clearing initial processing phase cache (${this.processedFilesInInitialPhase.size} files)`);
          this.processedFilesInInitialPhase.clear();
          this.processedFilesInInitialPhase = null;
        }
        
        // Generate a report after initial processing
        try {
          const report = this.reportingService.generateReport();
          if (report) {
            console.log('Initial processing phase complete. Report generated.');
          } else {
            console.warn('Initial processing phase complete. No report generated (no files processed by services).');
          }
        } catch (err) {
          console.error('Error generating report after initial phase:', err);
        }
      }, this.options.initialProcessingDelay);
    } else {
      // If not processing existing files, mark as complete immediately
      this.initialProcessingComplete = true;
    }
  }
  
  /**
   * Process existing files in the content root (Initial Launch Phase)
   * - Only applies assigned template/service logic
   * - Does NOT detect or log files as "new"
   */
  async processExistingFiles(): Promise<void> {
    console.log(`Processing existing files in ${this.contentRoot}... [Initial Launch Phase]`);
    // Track processed files in initial phase (not for new file detection)
    this.processedFilesInInitialPhase = new Set<string>();
    // Build directory list from USER_OPTIONS
    const directories = USER_OPTIONS.directories.map(d => path.join(this.contentRoot, d.path));
    for (let i = 0; i < directories.length; i++) {
      const directory = directories[i];
      const dirConfig = USER_OPTIONS.directories[i];
      try {
        if (!fsSync.existsSync(directory)) continue;
        const files = await fs.readdir(directory, { recursive: true });
        for (const file of files) {
          const filePath = path.join(directory, file.toString());
          if (filePath.endsWith('.md')) {
            // Only process with services/templates, do NOT treat as "new"
            await this.processFileWithConfig(filePath, dirConfig);
            this.processedFilesInInitialPhase.add(filePath);
          }
        }
      } catch (error) {
        console.error(`Error processing existing files in ${directory}:`, error);
      }
    }
    console.log(`Initial phase: Processed ${this.processedFilesInInitialPhase.size} files.`);
  }

  /**
   * Process a file with directory-specific config (template & services)
   * @param filePath The file path
   * @param dirConfig The config object for the directory
   */
  private async processFileWithConfig(filePath: string, dirConfig: any): Promise<void> {
    const template = this.templateRegistry.getAllTemplates().find(t => t.id === dirConfig.template);
    if (!template) {
      console.warn(`No template found for id ${dirConfig.template}, skipping ${filePath}`);
      return;
    }

    // Determine operation sequence (default to legacy behavior if not set)
    const sequence = dirConfig.operationSequence || [
      { op: 'addSiteUUID' },
      { op: 'updateDateModified' },
      { op: 'fetchOpenGraph' }
    ];

    // Extract initial frontmatter
    let { frontmatter } = extractFrontmatter(await fs.readFile(filePath, 'utf8')) || { frontmatter: {} };

    // Aggressive comment: Run each operation in sequence, re-extracting frontmatter after writes
    for (const step of sequence) {
      const handler = operationHandlers[step.op];
      if (!handler) {
        console.warn(`No handler for operation ${step.op}`);
        continue;
      }
      const result = await handler(frontmatter, filePath);
      if (result.changed) {
        // Write updated frontmatter to disk
        const content = await fs.readFile(filePath, 'utf8');
        const updatedContent = updateFrontmatter(content, result.frontmatter);
        await fs.writeFile(filePath, updatedContent, 'utf8');
        // Optionally add to recently modified set, etc.
      }
      // After each write, re-extract frontmatter for next step
      if (result.changed || step.op === 'extractFrontmatter') {
        const { frontmatter: newFrontmatter } = extractFrontmatter(await fs.readFile(filePath, 'utf8')) || {};
        frontmatter = newFrontmatter;
      }
      // Delay if specified
      if (step.delayMs) {
        await new Promise(res => setTimeout(res, step.delayMs));
      }
    }

    // Final validation and update using template
    await validateAndUpdateFrontmatter(filePath, template, this.templateRegistry, this.reportingService, frontmatter);
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers(): void {
    // On new file
    this.watcher.on('add', (filePath) => {
      this.onNewFile(filePath);
    });
    
    // On file change
    this.watcher.on('change', (filePath) => {
      this.onFileChanged(filePath);
    });
    
    // On error
    this.watcher.on('error', (error) => {
      console.error('Error in file watcher:', error);
    });
    
    // On ready
    this.watcher.on('ready', () => {
      console.log('Initial scan complete. Ready for changes.');
    });
  }
  
  /**
   * Set up periodic report generation
   */
  setupReportGeneration(): void {
    // Generate a report every hour
    setInterval(() => {
      console.log('Generating periodic report...');
      this.reportingService.generateReport();
    }, BATCH_REPORT_INTERVAL_MINUTES * 60 * 1000); // Convert minutes to ms
    
    // Also set up a handler for process termination to generate a final report
    process.on('SIGINT', () => {
      console.log('Process terminating, generating final report...');
      this.reportingService.generateReport();
      
      // Exit after a short delay to allow the report to be written
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });
    
    // Handle SIGTERM as well
    process.on('SIGTERM', () => {
      console.log('Process terminated, generating final report...');
      this.reportingService.generateReport();
      
      // Exit after a short delay to allow the report to be written
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });
  }
  
  /**
   * Process citations in a file
   * @param filePath The path to the file
   */
  async processCitationsInFile(filePath: string): Promise<void> {
    try {
      // Find the appropriate template for this file
      const template = this.templateRegistry.findTemplate(filePath);
      
      // If no template is found or it doesn't have citation config, skip processing
      if (!template || !template.citationConfig) {
        console.log(`No citation template found for ${filePath}, skipping citation processing`);
        return;
      }
      
      // Check if the file path matches the directories in the template's appliesTo.directories array
      const shouldProcessCitations = this.templateRegistry.doesFileMatchTemplate(filePath, template.id);
      if (!shouldProcessCitations) {
        console.log(`Skipping citation processing for ${filePath} - not in the directories specified in the template`);
        return;
      }
      
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Process citations
      const { updatedContent, changed, stats } = await processCitations(content, filePath, template.citationConfig);
      
      // If citations were changed, update the file
      if (changed) {
        this.reportingService.logCitationConversion(filePath, stats.citationsConverted);
        console.log(`Converted ${stats.citationsConverted} citations in ${filePath}`);
        
        // Write the updated content back to the file
        await fs.writeFile(filePath, updatedContent, 'utf8');
        console.log(`Updated citations in ${filePath}`);
        
        // Add to recently modified set and set a timeout to remove it
        this.recentlyModifiedByObserver.add(filePath);
        setTimeout(() => {
          this.recentlyModifiedByObserver.delete(filePath);
        }, this.modificationCooldownPeriod);
      } else {
        console.log(`No citation updates needed for ${filePath}`);
      }
    } catch (error) {
      console.error(`Error processing citations in ${filePath}:`, error);
    }
  }
  
  /**
   * Handle a new file event
   * @param filePath The path to the new file
   */
  async onNewFile(filePath: string): Promise<void> {
    // Only allow new file detection in observer mode (after initial phase)
    if (!this.initialProcessingComplete) {
      // Aggressive comment: Block new file logic during initial phase
      return;
    }
    // Ignore non-markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }
    console.log(`New file: ${filePath}`);
    
    // Skip if this file is already being processed to prevent infinite loops
    if (this.processingFiles.has(filePath)) {
      console.log(`Skipping ${filePath} as it's already being processed (preventing loop)`);
      return;
    }
    
    try {
      // Mark file as being processed
      this.processingFiles.add(filePath);
      
      console.log(`New file detected: ${filePath}`);
      
      try {
        // Read the file content
        const content = await fs.readFile(filePath, 'utf8');
        
        // Check if the file already has frontmatter
        if (content.startsWith('---')) {
          console.log(`File ${filePath} already has frontmatter, validating...`);
          
          // Extract frontmatter
          const frontmatter = extractFrontmatter(content);
          
          if (frontmatter) {
            // Find the appropriate template
            const template = this.templateRegistry.findTemplate(filePath);
            
            if (!template) {
              console.log(`No template found for ${filePath}`);
              return;
            }
            
            // Check for missing required fields
            const { updatedFrontmatter, changed } = await addMissingRequiredFields(
              frontmatter,
              template,
              filePath,
              this.reportingService
            );
            
            // Use a let variable that can be reassigned
            let frontmatterChanged = changed;
            
            // Log what fields were added
            if (frontmatterChanged) {
              console.log(`Added missing required fields to ${filePath}:`);
              for (const key of Object.keys(updatedFrontmatter)) {
                if (frontmatter[key] === undefined && updatedFrontmatter[key] !== undefined) {
                  console.log(`  - Added ${key}: ${updatedFrontmatter[key]}`);
                }
              }
              
              // Update the file with the new frontmatter
              const updatedContent = updateFrontmatter(content, updatedFrontmatter);
              await fs.writeFile(filePath, updatedContent, 'utf8');
              console.log(`Updated frontmatter in ${filePath}`);
              
              // Add to recently modified set and set a timeout to remove it
              this.recentlyModifiedByObserver.add(filePath);
              setTimeout(() => {
                this.recentlyModifiedByObserver.delete(filePath);
              }, this.modificationCooldownPeriod);
            } else {
              console.log(`No missing required fields in ${filePath}`);
            }
          }
        } else {
          // If no frontmatter, try to add it
          console.log(`File ${filePath} has no frontmatter, adding...`);
          
          // Find the appropriate template
          const template = this.templateRegistry.findTemplate(filePath);
          
          if (template) {
            // Format the frontmatter
            const formattedFrontmatter = formatFrontmatter(template);
            
            // Create the new content with frontmatter
            const newContent = `---\n${formattedFrontmatter}---\n\n${content}`;
            
            // Write the updated content back to the file
            await fs.writeFile(filePath, newContent, 'utf8');
            
            console.log(`Added frontmatter to ${filePath}`);
          } else {
            console.log(`No template found for ${filePath}`);
          }
        }
      } catch (error) {
        console.error(`Error processing new file ${filePath}:`, error);
      } finally {
        // Remove file from processing set when done
        this.processingFiles.delete(filePath);
      }
    } catch (error) {
      console.error(`Error processing new file ${filePath}:`, error);
    }
  }
  
  /**
   * Handle a file change event
   * @param filePath The path to the changed file
   */
  async onFileChanged(filePath: string): Promise<void> {
    // Ignore non-markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }
    
    console.log(`File changed: ${filePath}`);
    
    // Skip if this file is already being processed to prevent infinite loops
    if (this.processingFiles.has(filePath)) {
      console.log(`Skipping ${filePath} as it's already being processed (preventing loop)`);
      return;
    }
    
    // If we're in regular observer mode (after initial processing) and the file was changed by us,
    // don't process it again to prevent loops
    if (this.initialProcessingComplete) {
      // Check if this is a file we just updated
      const lastModified = (await fs.stat(filePath)).mtime.getTime();
      const currentTime = Date.now();
      const timeSinceModification = currentTime - lastModified;
      
      // If the file was modified very recently (within 5 seconds) and we're in regular observer mode,
      // it's likely our own update, so skip it
      if (timeSinceModification < 5000) {
        console.log(`Skipping recently modified file ${filePath} to prevent observer loop (modified ${timeSinceModification}ms ago)`);
        return;
      }
    } else {
      // During initial processing phase, we need to be more aggressive about preventing loops
      // Only process each file once during initial processing
      if (this.processedFilesInInitialPhase && this.processedFilesInInitialPhase.has(filePath)) {
        console.log(`Skipping ${filePath} during initial processing phase as it was already processed once`);
        return;
      }
      
      // Mark this file as processed during initial phase
      if (!this.processedFilesInInitialPhase) {
        this.processedFilesInInitialPhase = new Set<string>();
      }
      this.processedFilesInInitialPhase.add(filePath);
    }
    
    try {
      // Mark file as being processed
      this.processingFiles.add(filePath);
      
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Extract frontmatter from the content
      const frontmatter = extractFrontmatter(content);
      
      if (frontmatter) {
        console.log(`Frontmatter found in ${filePath}, checking for missing required fields...`);
        
        // Find the appropriate template
        const template = this.templateRegistry.findTemplate(filePath);
        
        if (!template) {
          console.log(`No template found for ${filePath}`);
          return;
        }
        
        // Check for missing required fields
        console.log(`Checking required fields for ${filePath} with template ${template.id}`);
        console.log(`Current frontmatter:`, frontmatter);
        
        const { updatedFrontmatter, changed } = await addMissingRequiredFields(
          frontmatter,
          template,
          filePath,
          this.reportingService
        );
        
        // Use a let variable that can be reassigned
        let frontmatterChanged = changed;
        
        // Log what fields were added
        if (frontmatterChanged) {
          console.log(`Added missing required fields to ${filePath}:`);
          for (const key of Object.keys(updatedFrontmatter)) {
            if (frontmatter[key] === undefined && updatedFrontmatter[key] !== undefined) {
              console.log(`  - Added ${key}: ${updatedFrontmatter[key]}`);
            }
          }
        } else {
          console.log(`No missing required fields in ${filePath}`);
        }
        
        // Validate against template
        const validationResult = this.templateRegistry.validate(filePath, updatedFrontmatter);
        
        if (!validationResult.valid) {
          reportValidationErrors(filePath, validationResult, this.reportingService);
          
          // Apply validation fixes if available
          if (validationResult.suggestedFixes && Object.keys(validationResult.suggestedFixes).length > 0) {
            console.log(`Applying suggested fixes for ${filePath}:`, validationResult.suggestedFixes);
            
            // Merge the suggested fixes with the updated frontmatter
            const fixedFrontmatter = {
              ...updatedFrontmatter,
              ...validationResult.suggestedFixes
            };
            
            // Update the frontmatter to use
            Object.assign(updatedFrontmatter, validationResult.suggestedFixes);
            
            // Mark as changed so it will be written to the file
            frontmatterChanged = true;
            
            console.log(`Updated frontmatter with fixes:`, updatedFrontmatter);
          }
        }
        
        // Only process citations if the template has citation configuration
        if (template.citationConfig) {
          console.log(`Processing citations for ${filePath} using template ${template.id}`);
          await this.processCitationsInFile(filePath);
        } else {
          console.log(`Skipping citation processing for ${filePath} - template ${template.id} does not have citation config`);
        }
        
        // If there are conversions needed or fields were added, update the file
        if (frontmatterChanged) {
          // Check if date_modified is the only field that would change
          let onlyDateModifiedChanged = false;
          if (frontmatterChanged && frontmatter) {
            const changedFields = Object.keys(updatedFrontmatter).filter(key => 
              JSON.stringify(updatedFrontmatter[key]) !== JSON.stringify(frontmatter[key])
            );
            
            if (changedFields.length === 1 && changedFields[0] === 'date_modified') {
              console.log(`Only date_modified would change in ${filePath}, skipping update to prevent unnecessary modifications`);
              onlyDateModifiedChanged = true;
              
              // During initial processing, skip updating files just for date_modified
              if (!this.initialProcessingComplete) {
                console.log(`Skipping date_modified update during initial processing phase for ${filePath}`);
              } else {
                // After initial processing, check if this is a user-modified file
                const lastModified = (await fs.stat(filePath)).mtime.getTime();
                const currentTime = Date.now();
                const timeSinceModification = currentTime - lastModified;
                
                // If the file was modified recently (within 60 seconds) and we're in regular observer mode,
                // it's likely a user update, so we should update date_modified
                if (timeSinceModification < 60000) {
                  console.log(`File ${filePath} was recently modified by user, updating date_modified`);
                  onlyDateModifiedChanged = false; // Allow the update to proceed
                }
              }
            }
          }
          
          if (!onlyDateModifiedChanged) {
            console.log(`Updating frontmatter in ${filePath} to add missing fields and/or convert properties...`);
            
            // Update the file with the new frontmatter
            const updatedContent = updateFrontmatter(content, updatedFrontmatter);
            await fs.writeFile(filePath, updatedContent, 'utf8');
            console.log(`Updated frontmatter in ${filePath}`);
            
            // Add to recently modified set and set a timeout to remove it
            this.recentlyModifiedByObserver.add(filePath);
            setTimeout(() => {
              this.recentlyModifiedByObserver.delete(filePath);
            }, this.modificationCooldownPeriod);
          } else {
            console.log(`No updates needed for ${filePath}`);
          }
        } else {
          console.log(`No frontmatter updates needed for ${filePath}`);
        }
      } else {
        // If no frontmatter, try to add it
        console.log(`No frontmatter found in ${filePath}, generating...`);
        const template = this.templateRegistry.findTemplate(filePath);
        
        if (template) {
          // Format the frontmatter
          const formattedFrontmatter = formatFrontmatter(template);
          
          // Create the new content with frontmatter
          const newContent = `---\n${formattedFrontmatter}---\n\n${content}`;
          
          // Write the updated content back to the file
          await fs.writeFile(filePath, newContent, 'utf8');
          
          console.log(`Added frontmatter to ${filePath}`);
        } else {
          console.log(`No template found for ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`Error processing file change for ${filePath}:`, error);
    } finally {
      // Remove file from processing set when done
      this.processingFiles.delete(filePath);
    }
  }
  
  /**
   * Start watching for file changes
   */
  startWatching(): void {
    // Add the content root to the watcher
    this.watcher.add(this.contentRoot);
    console.log(`Started watching ${this.contentRoot}`);
  }
  
  /**
   * Stop watching for file changes
   */
  stopWatching(): void {
    this.watcher.close();
    console.log('Stopped watching for file changes');
  }
}
