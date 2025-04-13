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
import { formatDate } from './utils/commonUtils'; // Import the formatDate utility
import { formatFrontmatter, extractFrontmatter, updateFrontmatter } from './utils/yamlFrontmatter';

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
  private processingFiles = new Set<string>();
  private recentlyModifiedByObserver = new Set<string>();
  private modificationCooldownPeriod = 5000; // 5 seconds
  private initialProcessingComplete = false;
  private processedFilesInInitialPhase: Set<string> | null = null;
  private initialProcessingTimeout: NodeJS.Timeout | null = null;
  
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
    this.watcher = chokidar.watch([
      path.join(contentRoot, 'tooling'),
      path.join(contentRoot, 'vocabulary'),
      path.join(contentRoot, 'lost-in-public/prompts'),
      path.join(contentRoot, 'specs')
    ], {
      persistent: true,
      ignoreInitial: this.options.ignoreInitial,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Set up report generation
    this.setupReportGeneration();
    
    // Set up initial processing timeout
    if (this.options.processExistingFiles) {
      console.log(`Initial processing mode active. Will switch to regular observer mode after ${this.options.initialProcessingDelay / 1000} seconds.`);
      this.initialProcessingTimeout = setTimeout(() => {
        console.log('Switching to regular observer mode...');
        this.initialProcessingComplete = true;
        
        // Clear the processed files set when switching to regular mode
        if (this.processedFilesInInitialPhase) {
          console.log(`Clearing initial processing phase cache (${this.processedFilesInInitialPhase.size} files)`);
          this.processedFilesInInitialPhase.clear();
          this.processedFilesInInitialPhase = null;
        }
        
        // Generate a report after initial processing
        this.reportingService.generateReport();
      }, this.options.initialProcessingDelay);
    } else {
      // If not processing existing files, mark as complete immediately
      this.initialProcessingComplete = true;
    }
  }
  
  /**
   * Set up event handlers for file system events
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
    }, 60 * 60 * 1000); // 1 hour
    
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
   * Process existing files in the content root
   */
  async processExistingFiles(): Promise<void> {
    console.log(`Processing existing files in ${this.contentRoot}...`);
    
    // Create a new set to track processed files
    this.processedFilesInInitialPhase = new Set<string>();
    
    // Process all markdown files in the content root
    const directories = [
      path.join(this.contentRoot, 'tooling'),
      path.join(this.contentRoot, 'vocabulary'),
      path.join(this.contentRoot, 'lost-in-public/prompts'),
      path.join(this.contentRoot, 'specs')
    ];
    
    for (const directory of directories) {
      try {
        // Check if the directory exists
        await fs.access(directory);
        
        // Get all markdown files in the directory
        const files = await fs.readdir(directory, { recursive: true });
        
        for (const file of files) {
          const filePath = path.join(directory, file.toString());
          
          // Only process markdown files
          if (filePath.endsWith('.md')) {
            // Process the file
            await this.onFileChanged(filePath);
          }
        }
      } catch (error) {
        console.error(`Error processing existing files in ${directory}:`, error);
      }
    }
    
    console.log(`Processed ${this.processedFilesInInitialPhase.size} existing files.`);
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
            
            // Log what fields were added
            if (changed) {
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
            }
          }
        } else {
          // If no frontmatter, try to add it
          console.log(`File ${filePath} has no frontmatter, adding...`);
          
          // Find the appropriate template
          const template = this.templateRegistry.findTemplate(filePath);
          
          if (template) {
            // Generate frontmatter from template
            const frontmatterToUse: Record<string, any> = {};
            
            // Add required fields
            if (template.required) {
              for (const [key, field] of Object.entries(template.required)) {
                try {
                  // If there's a defaultValueFn, use it to generate the value
                  if (field.defaultValueFn) {
                    const value = await field.defaultValueFn(filePath, frontmatterToUse);
                    
                    if (value !== undefined) {
                      frontmatterToUse[key] = value;
                      
                      // Log the field addition to the reporting service
                      this.reportingService.logFieldAdded(filePath, key, value);
                      
                      console.log(`Added required field ${key} with value ${value} to ${filePath}`);
                    }
                  }
                  // Otherwise, use the default value if provided
                  else if (field.defaultValue !== undefined) {
                    frontmatterToUse[key] = field.defaultValue;
                    
                    // Log the field addition to the reporting service
                    this.reportingService.logFieldAdded(filePath, key, field.defaultValue);
                    
                    console.log(`Added required field ${key} with default value ${field.defaultValue} to ${filePath}`);
                  }
                } catch (error) {
                  console.error(`Error adding required field ${key} to ${filePath}:`, error);
                }
              }
            }
            
            // Format the frontmatter
            const formattedFrontmatter = formatFrontmatter(frontmatterToUse);
            
            // Create the new content with frontmatter
            const newContent = `---\n${formattedFrontmatter}---\n\n${content}`;
            
            // Write the updated content back to the file
            await fs.writeFile(filePath, newContent, 'utf8');
            
            // Add to recently modified set and set a timeout to remove it
            this.recentlyModifiedByObserver.add(filePath);
            setTimeout(() => {
              this.recentlyModifiedByObserver.delete(filePath);
            }, this.modificationCooldownPeriod);
            
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
