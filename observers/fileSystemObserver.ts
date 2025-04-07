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
import * as yaml from 'js-yaml';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';
import { MetadataTemplate } from './types/template';
import { processOpenGraphMetadata } from './services/openGraphService';

/**
 * Extracts frontmatter from markdown content
 * @param content The markdown content
 * @param filePath The path to the file (for reporting)
 * @param reportingService The reporting service to use
 * @returns The extracted frontmatter as an object, or null if no frontmatter is found
 */
async function extractFrontmatter(
  content: string, 
  filePath: string, 
  reportingService: ReportingService
): Promise<{frontmatter: Record<string, any> | null, hasConversions: boolean, convertedFrontmatter?: Record<string, any>}> {
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    return { frontmatter: null, hasConversions: false };
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, hasConversions: false };
  }
  
  // Extract frontmatter content
  const frontmatterContent = content.substring(3, endIndex).trim();
  
  try {
    // Parse YAML frontmatter
    const frontmatter = yaml.load(frontmatterContent) as Record<string, any>;
    
    // Convert kebab-case properties to snake_case
    const result: Record<string, any> = {};
    let hasConversions = false;
    
    for (const [key, value] of Object.entries(frontmatter)) {
      // Check if the key contains hyphens (kebab-case)
      if (key.includes('-')) {
        // Convert kebab-case to snake_case
        const snakeCaseKey = key.replace(/-/g, '_');
        reportingService.logConversion(filePath, key, snakeCaseKey);
        result[snakeCaseKey] = value;
        hasConversions = true;
      } else {
        // Keep the original key
        result[key] = value;
      }
    }
    
    // Handle tags special case - only mark as conversion if tags format needs changing
    if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
      result.tags = frontmatter.tags;
      // Don't automatically set hasConversions = true here
    }
    
    return { 
      frontmatter: frontmatter, 
      hasConversions, 
      convertedFrontmatter: hasConversions ? result : undefined 
    };
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return { frontmatter: null, hasConversions: false };
  }
}

/**
 * Converts a string to Train-Case (first letter of each word capitalized, joined with hyphens)
 * @param str The string to convert
 * @returns The string in Train-Case
 */
function convertToTrainCase(str: string): string {
  // Handle empty strings
  if (!str || str.trim() === '') {
    return '';
  }
  
  console.log(`Converting to Train-Case: "${str}"`);
  
  // Split by spaces, hyphens, or underscores
  const words = str.split(/[-_\s]+/);
  
  // Capitalize first letter of each word
  const trainCase = words.map(word => {
    if (word.length === 0) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join('-');
  
  console.log(`Converted to Train-Case: "${str}" -> "${trainCase}"`);
  
  return trainCase;
}

/**
 * Formats frontmatter as YAML with proper tag formatting
 * @param frontmatter The frontmatter object
 * @returns Formatted YAML frontmatter
 */
function formatFrontmatter(frontmatter: Record<string, any>): string {
  // Create a copy of the frontmatter to avoid modifying the original
  const formattedFrontmatter = { ...frontmatter };
  
  // Handle special case for tags - convert array to list format
  if (formattedFrontmatter.tags && Array.isArray(formattedFrontmatter.tags)) {
    // Remove tags from the object, we'll add them manually
    const tags = formattedFrontmatter.tags;
    delete formattedFrontmatter.tags;
    
    // Convert the rest to YAML
    let yamlContent = yaml.dump(formattedFrontmatter);
    
    // Append tags in the correct format with Train-Case (first letter of each word capitalized)
    yamlContent += 'tags:\n';
    for (const tag of tags) {
      // Convert tag to Train-Case
      const trainCaseTag = convertToTrainCase(tag);
      yamlContent += `- ${trainCaseTag}\n`;
    }
    
    return yamlContent;
  }
  
  // No special handling needed
  return yaml.dump(formattedFrontmatter);
}

/**
 * Inserts frontmatter at the beginning of a file
 * @param filePath The path to the file
 * @param frontmatter The frontmatter to insert (either as an object or formatted YAML string)
 */
async function insertFrontmatter(filePath: string, frontmatter: Record<string, any> | string): Promise<void> {
  try {
    // Read the file content
    const content = await fs.readFile(filePath, 'utf8');
    
    // Convert frontmatter to YAML if it's an object
    const frontmatterYaml = typeof frontmatter === 'string' 
      ? frontmatter 
      : formatFrontmatter(frontmatter);
    
    // Insert frontmatter at the beginning of the file
    const newContent = `---\n${frontmatterYaml}---\n\n${content}`;
    await fs.writeFile(filePath, newContent, 'utf8');
    
    console.log(`Added frontmatter to ${filePath}`);
  } catch (error) {
    console.error(`Error inserting frontmatter to ${filePath}:`, error);
  }
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
  console.log(`Validation issues for ${filePath}:`);
  
  // Log the validation result to the reporting service
  reportingService.logValidation(filePath, validationResult);
  
  if (validationResult.errors.length > 0) {
    console.log('Errors:');
    for (const error of validationResult.errors) {
      console.log(`- ${error.field}: ${error.message}`);
    }
  }
  
  if (validationResult.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of validationResult.warnings) {
      console.log(`- ${warning.field}: ${warning.message}`);
    }
  }
  
  if (validationResult.suggestedFixes) {
    console.log('Suggested fixes:');
    console.log(validationResult.suggestedFixes);
  }
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
  
  try {
    console.log(`Checking required fields for ${filePath} against template ${template.id}`);
    
    // Check each required field
    for (const [key, field] of Object.entries(template.required)) {
      console.log(`Checking required field ${key} for ${filePath}`);
      
      // Special handling for date_created - compare with file birthtime
      if (key === 'date_created') {
        try {
          // Get file birthtime
          const fs = require('fs');
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            const birthtime = stats.birthtime;
            const birthtimeIso = birthtime.toISOString();
            
            // If date_created exists, check if birthtime is earlier
            if (updatedFrontmatter[key]) {
              const existingDate = new Date(updatedFrontmatter[key]);
              
              // If birthtime is earlier than the existing date_created, update it
              if (birthtime < existingDate) {
                console.log(`Updating date_created for ${filePath} from ${updatedFrontmatter[key]} to ${birthtimeIso} (file birthtime is earlier)`);
                updatedFrontmatter[key] = birthtimeIso;
                changed = true;
              } else {
                console.log(`Keeping existing date_created for ${filePath}: ${updatedFrontmatter[key]} (earlier than file birthtime ${birthtimeIso})`);
              }
            } 
            // If date_created doesn't exist, add it
            else {
              console.log(`Adding date_created for ${filePath}: ${birthtimeIso}`);
              updatedFrontmatter[key] = birthtimeIso;
              changed = true;
            }
            
            // Skip the standard field processing for date_created
            continue;
          }
        } catch (error) {
          console.error(`Error handling date_created for ${filePath}:`, error);
          // Continue with standard processing if there was an error
        }
      }
      
      // Standard field processing for other fields or if special handling failed
      // If the field is missing, add it with default value if available
      if (updatedFrontmatter[key] === undefined) {
        if (field.defaultValueFn) {
          // Generate default value using the provided function
          const defaultValue = field.defaultValueFn(filePath);
          
          // Special handling for tags to ensure proper format
          if (key === 'tags' && defaultValue) {
            if (Array.isArray(defaultValue) && defaultValue.length > 0) {
              updatedFrontmatter[key] = defaultValue;
              console.log(`Added default tags to ${filePath}: ${JSON.stringify(defaultValue)}`);
              changed = true;
            }
          } 
          // Special handling for date fields to ensure proper ISO format
          else if ((key === 'date_created' || key === 'date_modified') && defaultValue) {
            try {
              // Ensure date is in ISO format
              const dateValue = new Date(defaultValue).toISOString();
              updatedFrontmatter[key] = dateValue;
              console.log(`Added default ${key} to ${filePath}: ${dateValue}`);
              changed = true;
            } catch (error) {
              console.error(`Error formatting date for ${key} in ${filePath}:`, error);
            }
          }
          // Default handling for other fields
          else if (defaultValue !== undefined) {
            updatedFrontmatter[key] = defaultValue;
            console.log(`Added default ${key} to ${filePath}: ${defaultValue}`);
            changed = true;
          }
        } else {
          console.log(`No default value function for ${key} in template ${template.id}`);
        }
      } else {
        console.log(`Field ${key} already exists in ${filePath}`);
      }
    }
    
    // Process OpenGraph metadata if URL is present
    if (updatedFrontmatter.url || updatedFrontmatter.link) {
      console.log(`URL found in ${filePath}, processing OpenGraph metadata...`);
      
      // Process OpenGraph metadata
      const ogResult = await processOpenGraphMetadata(updatedFrontmatter, filePath);
      
      // Update frontmatter and changed flag
      const ogChanged = ogResult.changed;
      if (ogChanged) {
        // Copy over the updated frontmatter properties instead of reassigning
        Object.assign(updatedFrontmatter, ogResult.updatedFrontmatter);
        changed = true;
        
        // Log OpenGraph processing result
        if (updatedFrontmatter.og_error) {
          reportingService.logOpenGraphProcessing(filePath, 'failure');
        } else {
          reportingService.logOpenGraphProcessing(filePath, 'success');
        }
      } else {
        // If no changes were made, it was likely skipped
        reportingService.logOpenGraphProcessing(filePath, 'skipped');
      }
    }
    
    return { updatedFrontmatter, changed };
  } catch (error) {
    console.error(`Error adding missing required fields to ${filePath}:`, error);
    return { updatedFrontmatter, changed };
  }
}

/**
 * File System Observer class that watches for file changes and applies templates
 */
export class FileSystemObserver {
  private watcher: chokidar.FSWatcher;
  private templateRegistry: TemplateRegistry;
  private reportingService: ReportingService;
  private reportInterval: NodeJS.Timeout | null = null;
  
  /**
   * Create a new FileSystemObserver
   * @param templateRegistry The template registry to use
   * @param reportingService The reporting service to use
   * @param contentRoot The root directory to watch
   */
  constructor(
    templateRegistry: TemplateRegistry,
    reportingService: ReportingService,
    private contentRoot: string
  ) {
    this.templateRegistry = templateRegistry;
    this.reportingService = reportingService;
    
    // Initialize file watcher
    this.watcher = chokidar.watch(contentRoot, {
      ignored: /(^|[\/\\])\../, // Ignore dot files
      persistent: true,
      ignoreInitial: false,     // Process existing files on startup
    });
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Set up report generation
    this.setupReportGeneration();
  }
  
  /**
   * Set up event handlers for file system events
   */
  private setupEventHandlers(): void {
    // Handle new files
    this.watcher.on('add', async (filePath) => {
      // Only process markdown files
      if (!filePath.endsWith('.md')) {
        return;
      }
      
      console.log(`File added: ${filePath}`);
      await this.onNewFile(filePath);
    });
    
    // Handle file changes
    this.watcher.on('change', async (filePath) => {
      // Only process markdown files
      if (!filePath.endsWith('.md')) {
        return;
      }
      
      console.log(`File changed: ${filePath}`);
      await this.onFileChanged(filePath);
    });
    
    // Handle errors
    this.watcher.on('error', (error) => {
      console.error('Watcher error:', error);
    });
    
    // Log when ready
    this.watcher.on('ready', () => {
      console.log(`Initial scan complete. Watching for changes in ${this.contentRoot}`);
    });
  }
  
  /**
   * Set up periodic report generation
   */
  private setupReportGeneration(): void {
    // Set up periodic report generation (every 5 minutes)
    this.reportInterval = setInterval(async () => {
      // Only generate report if files were processed
      if (this.reportingService.hasProcessedFiles()) {
        const reportPath = await this.reportingService.writeReport();
        if (reportPath) {
          console.log(`Generated periodic report: ${reportPath}`);
        }
      } else {
        console.log('No files processed since last report, skipping report generation');
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Generate final report on process exit
    process.on('SIGINT', async () => {
      console.log('Received SIGINT, shutting down...');
      
      // Clear the report interval
      if (this.reportInterval) {
        clearInterval(this.reportInterval);
      }
      
      // Generate final report if files were processed
      if (this.reportingService.hasProcessedFiles()) {
        const reportPath = await this.reportingService.writeReport();
        if (reportPath) {
          console.log(`Generated final report: ${reportPath}`);
        }
      }
      
      // Close the watcher
      this.watcher.close();
      
      // Exit the process
      process.exit(0);
    });
  }
  
  /**
   * Handle a new file event
   * @param filePath The path to the new file
   */
  async onNewFile(filePath: string): Promise<void> {
    // Only process markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }
    
    console.log(`New file detected: ${filePath}`);
    
    try {
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Check if the file already has frontmatter
      if (content.startsWith('---')) {
        console.log(`File ${filePath} already has frontmatter, validating...`);
        
        // Extract frontmatter
        const frontmatterResult = await extractFrontmatter(content, filePath, this.reportingService);
        
        if (frontmatterResult.frontmatter) {
          // Find the appropriate template
          const template = this.templateRegistry.findTemplate(filePath);
          
          if (!template) {
            console.log(`No template found for ${filePath}`);
            return;
          }
          
          // Check for missing required fields
          const { updatedFrontmatter, changed } = await addMissingRequiredFields(
            frontmatterResult.frontmatter,
            template,
            filePath,
            this.reportingService
          );
          
          // Log what fields were added
          if (changed) {
            console.log(`Added missing required fields to ${filePath}:`);
            for (const key of Object.keys(updatedFrontmatter)) {
              if (frontmatterResult.frontmatter[key] === undefined && updatedFrontmatter[key] !== undefined) {
                console.log(`  - Added ${key}: ${updatedFrontmatter[key]}`);
              }
            }
          }
          
          // Validate against template
          const validationResult = this.templateRegistry.validate(filePath, updatedFrontmatter);
          
          // If there are conversions needed or fields were added, update the file
          const needsUpdate = frontmatterResult.hasConversions || changed;
          const frontmatterToUse = changed ? updatedFrontmatter : 
                                  (frontmatterResult.hasConversions ? frontmatterResult.convertedFrontmatter : null);
          
          if (needsUpdate && frontmatterToUse) {
            console.log(`Updating frontmatter in ${filePath} to add missing fields and/or convert properties...`);
            
            // Format the frontmatter with proper tag formatting
            const formattedFrontmatter = formatFrontmatter(frontmatterToUse);
            
            // Find the end of the original frontmatter
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
              // Replace the original frontmatter with the converted one
              const newContent = `---\n${formattedFrontmatter}---\n${content.substring(endIndex + 3)}`;
              await fs.writeFile(filePath, newContent, 'utf8');
              console.log(`Updated frontmatter in ${filePath}`);
            }
          } else if (!validationResult.valid) {
            reportValidationErrors(filePath, validationResult, this.reportingService);
          } else {
            console.log(`Frontmatter in ${filePath} is valid`);
          }
        } else {
          console.log(`Failed to parse frontmatter in ${filePath}`);
        }
      } else {
        console.log(`File ${filePath} does not have frontmatter, generating...`);
        
        // Generate frontmatter for the file
        const frontmatter = this.templateRegistry.applyTemplate(filePath);
        if (frontmatter) {
          await insertFrontmatter(filePath, frontmatter);
          console.log(`Added frontmatter to ${filePath}`);
        } else {
          console.log(`No template found for ${filePath}`);
        }
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
    // Only process markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }
    
    console.log(`File changed: ${filePath}`);
    
    try {
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Extract frontmatter
      const frontmatterResult = await extractFrontmatter(content, filePath, this.reportingService);
      
      if (frontmatterResult.frontmatter) {
        console.log(`Frontmatter found in ${filePath}, checking for missing required fields...`);
        
        // Find the appropriate template
        const template = this.templateRegistry.findTemplate(filePath);
        
        if (!template) {
          console.log(`No template found for ${filePath}`);
          return;
        }
        
        // Check for missing required fields
        console.log(`Checking required fields for ${filePath} with template ${template.id}`);
        console.log(`Current frontmatter:`, frontmatterResult.frontmatter);
        
        const { updatedFrontmatter, changed } = await addMissingRequiredFields(
          frontmatterResult.frontmatter,
          template,
          filePath,
          this.reportingService
        );
        
        // Log what fields were added
        if (changed) {
          console.log(`Added missing required fields to ${filePath}:`);
          for (const key of Object.keys(updatedFrontmatter)) {
            if (frontmatterResult.frontmatter[key] === undefined && updatedFrontmatter[key] !== undefined) {
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
        }
        
        // If there are conversions needed or fields were added, update the file
        const needsUpdate = frontmatterResult.hasConversions || changed;
        const frontmatterToUse = changed ? updatedFrontmatter : 
                                (frontmatterResult.hasConversions ? frontmatterResult.convertedFrontmatter : null);
        
        if (needsUpdate && frontmatterToUse) {
          console.log(`Updating frontmatter in ${filePath} to add missing fields and/or convert properties...`);
          console.log(`Updated frontmatter:`, frontmatterToUse);
          
          // Format the frontmatter with proper tag formatting
          const formattedFrontmatter = formatFrontmatter(frontmatterToUse);
          
          // Find the end of the original frontmatter
          const endIndex = content.indexOf('---', 3);
          if (endIndex !== -1) {
            // Replace the original frontmatter with the converted one
            const newContent = `---\n${formattedFrontmatter}---\n${content.substring(endIndex + 3)}`;
            await fs.writeFile(filePath, newContent, 'utf8');
            console.log(`Updated frontmatter in ${filePath}`);
          }
        } else {
          console.log(`No updates needed for ${filePath}`);
        }
      } else {
        // If no frontmatter, try to add it
        console.log(`No frontmatter found in ${filePath}, generating...`);
        const template = this.templateRegistry.applyTemplate(filePath);
        if (template) {
          await insertFrontmatter(filePath, template);
          console.log(`Added frontmatter to ${filePath}`);
        } else {
          console.log(`No template found for ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`Error processing file change for ${filePath}:`, error);
    }
  }
  
  /**
   * Start watching for file changes
   */
  startWatching(): void {
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
