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

/**
 * Extracts frontmatter from markdown content using regex only - no YAML libraries
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
    // Parse frontmatter using regex, not YAML library
    const frontmatter: Record<string, any> = {};
    let hasConversions = false;
    const result: Record<string, any> = {};
    
    // Split by lines and process each line
    const lines = frontmatterContent.split('\n');
    
    // Track current array property being processed
    let currentArrayProperty: string | null = null;
    let arrayValues: any[] = [];
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Check if this is an array item
      if (line.startsWith('- ') && currentArrayProperty) {
        // Add to current array
        arrayValues.push(line.substring(2).trim());
        continue;
      }
      
      // If we were processing an array and now hit a new property, save the array
      if (currentArrayProperty && !line.startsWith('- ')) {
        frontmatter[currentArrayProperty] = arrayValues;
        currentArrayProperty = null;
        arrayValues = [];
      }
      
      // Check for key-value pair
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Check if this is the start of an array
        if (!value) {
          currentArrayProperty = key;
          arrayValues = [];
          continue;
        }
        
        // Handle different value types
        if (value === 'null' || value === '') {
          frontmatter[key] = null;
        } else if (value === 'true') {
          frontmatter[key] = true;
        } else if (value === 'false') {
          frontmatter[key] = false;
        } else if (!isNaN(Number(value)) && !value.startsWith('0')) {
          // Only convert to number if it doesn't start with 0 (to preserve things like versions)
          frontmatter[key] = value.includes('.') ? parseFloat(value) : parseInt(value);
        } else {
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
          }
          
          // Remove block scalar syntax if present (>-, >+, |-, |+)
          if (value === ">-" || value === ">+" || value === "|-" || value === "|+") {
            // If it's just the block scalar marker, treat it as an empty string
            value = "";
          } else if (value.startsWith(">-") || value.startsWith(">+") || 
                     value.startsWith("|-") || value.startsWith("|+")) {
            // If it starts with a block scalar marker, remove it
            value = value.substring(2).trim();
          }
          
          frontmatter[key] = value;
        }
        
        // Check if the key contains hyphens (kebab-case)
        if (key.includes('-')) {
          // Convert kebab-case to snake_case
          const snakeCaseKey = key.replace(/-/g, '_');
          reportingService.logConversion(filePath, key, snakeCaseKey);
          result[snakeCaseKey] = frontmatter[key];
          hasConversions = true;
        } else {
          // Keep the original key
          result[key] = frontmatter[key];
        }
      }
    }
    
    // Handle any remaining array
    if (currentArrayProperty) {
      frontmatter[currentArrayProperty] = arrayValues;
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
export function formatFrontmatter(frontmatter: Record<string, any>): string {
  // Create a copy of the frontmatter to avoid modifying the original
  const formattedFrontmatter = { ...frontmatter };
  
  // Arrays that should be formatted with list syntax (with hyphens)
  const arrayFields = ['tags', 'authors', 'aliases'];
  
  // Fields that should never have quotes, even if they contain special characters
  const neverQuoteFields = ['title', 'lede', 'category', 'status', 'augmented_with'];
  
  // Extract all array fields that need special formatting
  const extractedArrays: Record<string, any[]> = {};
  
  for (const field of arrayFields) {
    if (formattedFrontmatter[field] && Array.isArray(formattedFrontmatter[field])) {
      extractedArrays[field] = formattedFrontmatter[field];
      delete formattedFrontmatter[field];
    }
  }
  
  // Manually construct the YAML to ensure proper formatting
  let yamlContent = '';
  
  // Process each field in the frontmatter
  for (const [key, value] of Object.entries(formattedFrontmatter)) {
    // Skip array fields (they're handled separately)
    if (arrayFields.includes(key)) continue;
    
    // Handle date fields specially to avoid quotes and timestamps
    if (key.startsWith('date_') && value) {
      // Use the formatDate utility function from commonUtils
      const formattedDate = formatDate(value);
      yamlContent += `${key}: ${formattedDate}\n`;
    }
    // Handle null values
    else if (value === null) {
      yamlContent += `${key}: null\n`;
    }
    // Handle string values
    else if (typeof value === 'string') {
      // Never add quotes to certain fields, even if they contain special characters
      if (neverQuoteFields.includes(key)) {
        yamlContent += `${key}: ${value}\n`;
      }
      // If the string contains special characters or newlines, always quote it
      // NEVER use block scalar syntax (>- or |-) for any values
      else if (/[:#\[\]{}|>*&!%@,]/.test(value) || value.includes('\n')) {
        // Escape any double quotes in the value
        const escapedValue = value.replace(/"/g, '\\"');
        yamlContent += `${key}: "${escapedValue}"\n`;
      } else {
        yamlContent += `${key}: ${value}\n`;
      }
    }
    // Handle other values
    else {
      yamlContent += `${key}: ${value}\n`;
    }
  }
  
  // Append each array field in the correct format
  for (const [field, values] of Object.entries(extractedArrays)) {
    yamlContent += `${field}:\n`;
    for (const value of values) {
      // For tags, convert to Train-Case if needed
      const formattedValue = field === 'tags' ? convertToTrainCase(value) : value;
      yamlContent += `  - ${formattedValue}\n`;
    }
  }
  
  return yamlContent;
}

/**
 * Inserts frontmatter at the beginning of a file
 * @param filePath The path to the file
 * @param frontmatter The frontmatter to insert
 */
async function insertFrontmatter(filePath: string, frontmatter: Record<string, any> | string): Promise<void> {
  try {
    // Read the file content
    const content = await fs.readFile(filePath, 'utf8');
    
    // Check if the file already has frontmatter
    const hasFrontmatter = content.trimStart().startsWith('---');
    
    if (hasFrontmatter) {
      console.log(`File ${filePath} already has frontmatter, skipping insertion`);
      return;
    }
    
    // Format the frontmatter
    let frontmatterYaml: string;
    if (typeof frontmatter === 'string') {
      frontmatterYaml = frontmatter;
    } else {
      frontmatterYaml = formatFrontmatter(frontmatter);
    }
    
    // Create the new content with frontmatter
    const newContent = `---\n${frontmatterYaml}---\n\n${content}`;
    
    // Write the updated content back to the file
    await fs.writeFile(filePath, newContent, 'utf8');
    
    console.log(`Added frontmatter to ${filePath}`);
  } catch (error) {
    console.error(`Error inserting frontmatter into ${filePath}:`, error);
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
  try {
    // Create a copy of the frontmatter to avoid modifying the original
    const updatedFrontmatter = { ...frontmatter };
    let changed = false;
    
    // Add missing required fields
    for (const fieldName of Object.keys(template.required)) {
      const field = template.required[fieldName];
      if (updatedFrontmatter[fieldName] === undefined) {
        // Field is missing, check if there's a defaultValueFn in the template
        if (field.defaultValueFn) {
          // Use the defaultValueFn from the template
          const defaultValue = field.defaultValueFn(filePath);
          if (defaultValue !== undefined && defaultValue !== null) {
            updatedFrontmatter[fieldName] = defaultValue;
            reportingService.logFieldAdded(filePath, fieldName, defaultValue);
            console.log(`Added ${fieldName} using defaultValueFn: ${defaultValue}`);
            changed = true;
          }
        } else if (field.defaultValue !== undefined) {
          // Use the default value from the template
          updatedFrontmatter[fieldName] = field.defaultValue;
          reportingService.logFieldAdded(filePath, fieldName, field.defaultValue);
          changed = true;
        } else if (fieldName === 'date') {
          // Special case for date field - use current date
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          updatedFrontmatter.date = today;
          reportingService.logFieldAdded(filePath, 'date', today);
          changed = true;
        } else if (fieldName === 'date_created') {
          // Special case for date_created field - use current date
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          updatedFrontmatter.date_created = today;
          reportingService.logFieldAdded(filePath, 'date_created', today);
          changed = true;
        } else if (fieldName === 'date_modified') {
          // Special case for date_modified field - use current date only if it's missing
          if (updatedFrontmatter[fieldName] === undefined) {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            updatedFrontmatter.date_modified = today;
            reportingService.logFieldAdded(filePath, 'date_modified', today);
            changed = true;
          }
        } else if (fieldName === 'title') {
          // Special case for title field - derive from filename
          const filename = path.basename(filePath, path.extname(filePath));
          const title = convertToTrainCase(filename);
          updatedFrontmatter.title = title;
          reportingService.logFieldAdded(filePath, 'title', title);
          changed = true;
        } else if (fieldName === 'tags') {
          // Special case for tags field - derive from directory structure
          const relativeDir = path.dirname(filePath).split('/content/')[1] || '';
          const tags = relativeDir.split('/').filter(Boolean);
          
          // Only add tags if we have some
          if (tags.length > 0) {
            updatedFrontmatter.tags = tags;
            reportingService.logFieldAdded(filePath, 'tags', tags.join(', '));
            changed = true;
          }
        } else if (fieldName === 'slug') {
          // Special case for slug field - derive from filename
          const filename = path.basename(filePath, path.extname(filePath));
          const slug = filename.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          updatedFrontmatter.slug = slug;
          reportingService.logFieldAdded(filePath, 'slug', slug);
          changed = true;
        } else if (fieldName === 'description' && process.env.OPEN_GRAPH_IO_API_KEY) {
          // Special case for description field - try to fetch from OpenGraph
          try {
            const url = updatedFrontmatter.url;
            if (url) {
              const ogData = await processOpenGraphMetadata(url, filePath);
              if (ogData.updatedFrontmatter && ogData.updatedFrontmatter.description) {
                updatedFrontmatter.description = ogData.updatedFrontmatter.description;
                reportingService.logFieldAdded(filePath, 'description', ogData.updatedFrontmatter.description);
                changed = true;
              }
            }
          } catch (error) {
            console.error(`Error fetching OpenGraph data for ${filePath}:`, error);
          }
        }
      }
    }
    
    return { updatedFrontmatter, changed };
  } catch (error) {
    console.error(`Error adding missing required fields to ${filePath}:`, error);
    return { updatedFrontmatter: frontmatter, changed: false };
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
  private processingFiles: Set<string> = new Set();
  private initialProcessingComplete: boolean = false;
  private processedFilesInInitialPhase: Set<string> | null = null;
  private initialProcessingTimeout: NodeJS.Timeout | null = null;
  private recentlyModifiedByObserver: Set<string> = new Set();
  private modificationCooldownPeriod: number = 2000; // 2 seconds cooldown
  private reportInterval: NodeJS.Timeout | null = null;
  
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
  private setupEventHandlers(): void {
    // Handle new files
    this.watcher.on('add', async (filePath) => {
      // Only process markdown files
      if (!filePath.endsWith('.md')) {
        return;
      }
      
      console.log(`File added: ${filePath}`);
      
      // First process citations
      await this.processCitationsInFile(filePath);
      
      // Then process frontmatter (in a separate operation)
      await this.onNewFile(filePath);
    });
    
    // Handle file changes
    this.watcher.on('change', async (filePath) => {
      // Only process markdown files
      if (!filePath.endsWith('.md')) {
        return;
      }
      
      console.log(`File changed: ${filePath}`);
      
      // First process citations
      await this.processCitationsInFile(filePath);
      
      // Then process frontmatter (in a separate operation)
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
   * Process citations in a file
   * @param filePath The path to the file
   */
  async processCitationsInFile(filePath: string): Promise<void> {
    // Ignore non-markdown files
    if (!filePath.endsWith('.md')) {
      return;
    }
    
    console.log(`Processing citations in file: ${filePath}`);
    
    // Skip if this file is already being processed to prevent infinite loops
    if (this.processingFiles.has(filePath)) {
      console.log(`Skipping citation processing for ${filePath} as it's already being processed (preventing loop)`);
      return;
    }
    
    // Skip if this file was recently modified by the observer
    if (this.recentlyModifiedByObserver.has(filePath)) {
      console.log(`Skipping citation processing for ${filePath} as it was recently modified by the observer`);
      return;
    }
    
    try {
      // Mark file as being processed
      this.processingFiles.add(filePath);
      
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Find the templates that apply to this file
      const templates = this.templateRegistry.findTemplateForFile(filePath);
      
      if (templates && templates.length > 0) {
        // Use the first template with content processing
        const template = templates[0];
        // Check if contentProcessing exists before accessing its processor
        if (template.contentProcessing && template.contentProcessing.enabled) {
          console.log(`Using content processor from template: ${template.id}`);
          const { updatedContent, changed, stats } = await template.contentProcessing.processor(content, filePath);
          
          // If content was changed, update the file
          if (changed) {
            // Add detailed reporting based on stats
            if (stats && stats.citationsConverted) {
              this.reportingService.logCitationConversion(filePath, stats.citationsConverted);
              console.log(`Converted ${stats.citationsConverted} citations in ${filePath}`);
            }
            
            if (stats && stats.footnotesAdded) {
              console.log(`Added ${stats.footnotesAdded} footnote definitions in ${filePath}`);
            }
            
            if (stats && stats.footnoteSectionAdded) {
              console.log(`Added Footnotes section in ${filePath}`);
            }
            
            // Write the updated content back to the file
            await fs.writeFile(filePath, updatedContent, 'utf8');
            console.log(`Updated content in ${filePath}`);
            
            // Add to recently modified set and set a timeout to remove it
            this.recentlyModifiedByObserver.add(filePath);
            setTimeout(() => {
              this.recentlyModifiedByObserver.delete(filePath);
            }, this.modificationCooldownPeriod);
          } else {
            console.log(`No content updates needed for ${filePath}`);
          }
        } else {
          // Fall back to direct citation processing if no template with content processing is found
          console.log(`No content processing template found for ${filePath}, using default citation processing`);
          const { updatedContent, changed: citationsChanged, stats } = await processCitations(content, filePath);
          
          // If citations were changed, update the file
          if (citationsChanged) {
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
        }
      } else {
        // Fall back to direct citation processing if no template is found
        console.log(`No template found for ${filePath}, using default citation processing`);
        const { updatedContent, changed: citationsChanged, stats } = await processCitations(content, filePath);
        
        // If citations were changed, update the file
        if (citationsChanged) {
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
      }
    } catch (error) {
      console.error(`Error processing citations in ${filePath}:`, error);
    } finally {
      // Remove file from processing set when done
      this.processingFiles.delete(filePath);
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
                let bodyContent = content.substring(endIndex + 3);
                
                // Extract the actual content, ignoring all blank lines at the beginning
                const actualContent = bodyContent.replace(/^\s+/, '').trim();
                
                // Create new content with proper frontmatter and exactly two newlines after it
                const newContent = `---\n${formattedFrontmatter}---\n\n${actualContent}`;
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
        
        // Use a let variable that can be reassigned
        let frontmatterChanged = changed;
        
        // Log what fields were added
        if (frontmatterChanged) {
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
        
        // If there are conversions needed or fields were added, update the file
        const needsUpdate = frontmatterResult.hasConversions || frontmatterChanged;
        
        // Check if date_modified is the only field that would change
        let onlyDateModifiedChanged = false;
        if (frontmatterChanged && frontmatterResult.frontmatter && 
            Object.keys(updatedFrontmatter).length === Object.keys(frontmatterResult.frontmatter).length) {
          const changedFields = Object.keys(updatedFrontmatter).filter(key => 
            JSON.stringify(updatedFrontmatter[key]) !== JSON.stringify(frontmatterResult.frontmatter?.[key])
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
        
        const frontmatterToUse = frontmatterChanged ? updatedFrontmatter : 
                                (frontmatterResult.hasConversions ? frontmatterResult.convertedFrontmatter : frontmatterResult.frontmatter);
        
        if (needsUpdate && frontmatterToUse && !onlyDateModifiedChanged) {
          console.log(`Updating frontmatter in ${filePath} to add missing fields and/or convert properties...`);
          console.log(`Updated frontmatter:`, frontmatterToUse);
          
          // Format the frontmatter with proper tag formatting
          const formattedFrontmatter = formatFrontmatter(frontmatterToUse);
          
          // Find the end of the original frontmatter
          const endIndex = content.indexOf('---', 3);
          if (endIndex !== -1) {
            // Replace the original frontmatter with the converted one
            
            // Extract the body content after the frontmatter
            let bodyContent = content.substring(endIndex + 3);
            
            // Extract the actual content, ignoring all blank lines at the beginning
            // This is a more aggressive approach to strip excessive blank lines
            const actualContent = bodyContent.replace(/^\s+/, '').trim();
            
            // Create new content with proper frontmatter and exactly two newlines after it
            // This ensures consistent formatting across all files
            const newContent = `---\n${formattedFrontmatter}---\n\n${actualContent}`;
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
    } finally {
      // Remove file from processing set when done
      this.processingFiles.delete(filePath);
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
