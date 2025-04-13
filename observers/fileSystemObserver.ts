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
import * as path from 'path';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';
import { MetadataTemplate } from './types/template';
import { processOpenGraphMetadata } from './services/openGraphService';
import { processCitations } from './services/citationService';
import { formatDate } from './utils/commonUtils';
import { formatFrontmatter, extractFrontmatter, updateFrontmatter } from './utils/yamlFormatter';

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
  
  return { updatedFrontmatter, changed };
}

/**
 * File System Observer class that watches for file changes and applies templates
 */
export class FileSystemObserver {
  private watcher: chokidar.FSWatcher;
  private templateRegistry: TemplateRegistry;
  private reportingService: ReportingService;
  private contentRoot: string;
  private processingFiles: Set<string> = new Set();
  private recentlyModifiedByObserver: Set<string> = new Set();
  private modificationCooldownPeriod: number = 5000; // 5 seconds
  private initialProcessingComplete: boolean = false;
  private processedFilesInInitialPhase: Set<string> | null = null;
  private reportGenerationInterval: NodeJS.Timeout | null = null;
  
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
    this.templateRegistry = templateRegistry;
    this.reportingService = reportingService;
    this.contentRoot = contentRoot;
    
    // Create a new watcher
    this.watcher = chokidar.watch([], {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: options.ignoreInitial !== undefined ? options.ignoreInitial : true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Set up periodic report generation
    this.setupReportGeneration();
    
    // Set up initial processing if requested
    if (options.processExistingFiles) {
      this.processExistingFiles();
    }
    
    // Set up a timer to mark initial processing as complete after a delay
    if (options.initialProcessingDelay) {
      setTimeout(() => {
        console.log('Initial processing phase complete, switching to regular observer mode');
        this.initialProcessingComplete = true;
        this.processedFilesInInitialPhase = null; // Free up memory
      }, options.initialProcessingDelay);
    } else {
      this.initialProcessingComplete = true;
    }
  }
  
  /**
   * Set up event handlers for file system events
   */
  private setupEventHandlers(): void {
    // Handle new files
    this.watcher.on('add', (filePath) => {
      this.onNewFile(filePath);
    });
    
    // Handle file changes
    this.watcher.on('change', (filePath) => {
      this.onFileChanged(filePath);
    });
    
    // Handle errors
    this.watcher.on('error', (error) => {
      console.error('Error in file watcher:', error);
    });
    
    // Handle ready event
    this.watcher.on('ready', () => {
      console.log('Initial scan complete. Ready for changes');
    });
  }
  
  /**
   * Set up periodic report generation
   */
  private setupReportGeneration(): void {
    // Generate a report every 5 minutes
    this.reportGenerationInterval = setInterval(async () => {
      // Only generate a report if there are processed files
      if (this.reportingService.hasProcessedFiles()) {
        console.log('Generating periodic report...');
        const reportPath = await this.reportingService.writeReport();
        if (reportPath) {
          console.log(`Report written to ${reportPath}`);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Generate a final report when the process exits
    process.on('SIGINT', async () => {
      console.log('Received SIGINT, generating final report...');
      
      // Clear the interval to prevent duplicate reports
      if (this.reportGenerationInterval) {
        clearInterval(this.reportGenerationInterval);
      }
      
      // Generate a final report
      const reportPath = await this.reportingService.writeReport();
      if (reportPath) {
        console.log(`Final report written to ${reportPath}`);
      }
      
      // Exit the process
      process.exit(0);
    });
  }
  
  /**
   * Process existing files in the content root
   */
  private async processExistingFiles(): Promise<void> {
    console.log(`Processing existing files in ${this.contentRoot}...`);
    
    // Get all templates
    const templates = this.templateRegistry.getAllTemplates();
    
    // Process each template
    for (const template of templates) {
      // Skip templates without directories
      if (!template.appliesTo.directories || template.appliesTo.directories.length === 0) {
        continue;
      }
      
      // Process each directory
      for (const directory of template.appliesTo.directories) {
        const directoryPath = path.join(this.contentRoot, directory);
        
        try {
          // Get all markdown files in the directory
          const files = await fs.readdir(directoryPath, { recursive: true });
          
          // Process each file
          for (const file of files) {
            const filePath = path.join(directoryPath, file);
            
            // Skip non-markdown files
            if (!filePath.endsWith('.md')) {
              continue;
            }
            
            // Process the file
            await this.onFileChanged(filePath);
          }
        } catch (error) {
          console.error(`Error processing directory ${directoryPath}:`, error);
        }
      }
    }
  }
  
  /**
   * Process citations in a file
   * @param filePath The path to the file
   */
  async processCitationsInFile(filePath: string): Promise<void> {
    try {
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Process citations
      const { updatedContent, changed, stats } = await processCitations(content, filePath);
      
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
      
      // Find the appropriate template for this file
      const template = this.templateRegistry.findTemplate(filePath);
      
      // If no template is found, skip processing
      if (!template) {
        console.log(`No template found for ${filePath}, skipping processing`);
        this.processingFiles.delete(filePath);
        return;
      }
      
      // Only process citations if the template has citation configuration
      if (template.citationConfig) {
        console.log(`Processing citations for ${filePath} using template ${template.id}`);
        await this.processCitationsInFile(filePath);
      } else {
        console.log(`Skipping citation processing for ${filePath} - template ${template.id} does not have citation config`);
      }
      
      try {
        // Read the file content
        const content = await fs.readFile(filePath, 'utf8');
        
        // Extract frontmatter from the content
        const frontmatter = extractFrontmatter(content);
        
        if (frontmatter) {
          console.log(`Frontmatter found in new file ${filePath}, validating...`);
          
          // Add missing required fields
          let { updatedFrontmatter, changed } = await addMissingRequiredFields(
            frontmatter,
            template,
            filePath,
            this.reportingService
          );
          
          // Validate against template
          const validationResult = this.templateRegistry.validate(filePath, updatedFrontmatter);
          
          if (!validationResult.valid) {
            reportValidationErrors(filePath, validationResult, this.reportingService);
            
            // Apply validation fixes if available
            if (validationResult.suggestedFixes && Object.keys(validationResult.suggestedFixes).length > 0) {
              console.log(`Applying suggested fixes for ${filePath}:`, validationResult.suggestedFixes);
              
              // Merge the suggested fixes with the updated frontmatter
              Object.assign(updatedFrontmatter, validationResult.suggestedFixes);
              
              // Mark as changed so it will be written to the file
              changed = true;
            }
          }
          
          // Check if date_modified is the only field that would change
          let onlyDateModifiedChanged = false;
          if (changed && frontmatter) {
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
          
          if (changed && !onlyDateModifiedChanged) {
            console.log(`Updating frontmatter in ${filePath} to add missing fields and/or convert properties...`);
            
            // Update the file with the new frontmatter
            const updatedContent = updateFrontmatter(content, updatedFrontmatter);
            await fs.writeFile(filePath, updatedContent, 'utf8');
            console.log(`Updated frontmatter in ${filePath}`);
          } else {
            console.log(`No updates needed for ${filePath}`);
          }
        } else {
          console.log(`File ${filePath} does not have frontmatter, generating...`);
          
          // Generate frontmatter for the file
          const template = this.templateRegistry.applyTemplate(filePath);
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
      
      // Find the appropriate template for this file
      const template = this.templateRegistry.findTemplate(filePath);
      
      // If no template is found, skip processing
      if (!template) {
        console.log(`No template found for ${filePath}, skipping processing`);
        this.processingFiles.delete(filePath);
        return;
      }
      
      // Only process citations if the template has citation configuration
      if (template.citationConfig) {
        console.log(`Processing citations for ${filePath} using template ${template.id}`);
        await this.processCitationsInFile(filePath);
      } else {
        console.log(`Skipping citation processing for ${filePath} - template ${template.id} does not have citation config`);
      }
      
      try {
        // Read the file content
        const content = await fs.readFile(filePath, 'utf8');
        
        // Extract frontmatter from the content
        const frontmatter = extractFrontmatter(content);
        
        if (frontmatter) {
          console.log(`Frontmatter found in ${filePath}, checking for missing required fields...`);
          
          // Check for missing required fields
          console.log(`Checking required fields for ${filePath} with template ${template.id}`);
          
          let { updatedFrontmatter, changed } = await addMissingRequiredFields(
            frontmatter,
            template,
            filePath,
            this.reportingService
          );
          
          // Log what fields were added
          if (changed) {
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
              Object.assign(updatedFrontmatter, validationResult.suggestedFixes);
              
              // Mark as changed so it will be written to the file
              changed = true;
            }
          }
          
          // Check if date_modified is the only field that would change
          let onlyDateModifiedChanged = false;
          if (changed && frontmatter) {
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
          
          if (changed && !onlyDateModifiedChanged) {
            console.log(`Updating frontmatter in ${filePath} to add missing fields and/or convert properties...`);
            
            // Update the file with the new frontmatter
            const updatedContent = updateFrontmatter(content, updatedFrontmatter);
            await fs.writeFile(filePath, updatedContent, 'utf8');
            console.log(`Updated frontmatter in ${filePath}`);
          } else {
            console.log(`No updates needed for ${filePath}`);
          }
        } else {
          // If no frontmatter, try to add it
          console.log(`No frontmatter found in ${filePath}, generating...`);
          const template = this.templateRegistry.applyTemplate(filePath);
          
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
    } catch (error) {
      console.error(`Error processing file change for ${filePath}:`, error);
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
