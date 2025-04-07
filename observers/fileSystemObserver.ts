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

/**
 * Extracts frontmatter from markdown content
 * @param content The markdown content
 * @returns The extracted frontmatter as an object, or null if no frontmatter is found
 */
async function extractFrontmatter(content: string): Promise<Record<string, any> | null> {
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    return null;
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }
  
  // Extract frontmatter content
  const frontmatterContent = content.substring(3, endIndex).trim();
  
  try {
    // Parse YAML frontmatter
    return yaml.load(frontmatterContent) as Record<string, any>;
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return null;
  }
}

/**
 * Inserts frontmatter at the beginning of a file
 * @param filePath The path to the file
 * @param frontmatter The frontmatter to insert
 */
async function insertFrontmatter(filePath: string, frontmatter: string): Promise<void> {
  try {
    // Read the file content
    const content = await fs.readFile(filePath, 'utf8');
    
    // Check if file already has frontmatter
    if (content.startsWith('---')) {
      console.log(`File ${filePath} already has frontmatter, skipping`);
      return;
    }
    
    // Insert frontmatter at the beginning of the file
    const newContent = `${frontmatter}${content}`;
    await fs.writeFile(filePath, newContent, 'utf8');
    console.log(`Inserted frontmatter into ${filePath}`);
  } catch (error) {
    console.error(`Error inserting frontmatter into ${filePath}:`, error);
  }
}

/**
 * Reports validation errors for a file
 * @param filePath The path to the file
 * @param validationResult The validation result
 */
function reportValidationErrors(filePath: string, validationResult: any): void {
  console.log(`Validation issues for ${filePath}:`);
  
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
 * File System Observer class that watches for file changes and applies templates
 */
export class FileSystemObserver {
  private watcher: chokidar.FSWatcher;
  private templateRegistry: TemplateRegistry;
  
  /**
   * Create a new FileSystemObserver
   * @param templateRegistry The template registry to use
   * @param contentRoot The root directory to watch
   */
  constructor(
    templateRegistry: TemplateRegistry,
    private contentRoot: string
  ) {
    this.templateRegistry = templateRegistry;
    
    // Initialize file watcher
    this.watcher = chokidar.watch(contentRoot, {
      ignored: /(^|[\/\\])\../, // Ignore dot files
      persistent: true,
      ignoreInitial: false,     // Process existing files on startup
    });
    
    // Set up event handlers
    this.setupEventHandlers();
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
      await this.onFileChange(filePath);
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
   * Handle a new file event
   * @param filePath The path to the new file
   */
  async onNewFile(filePath: string): Promise<void> {
    try {
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Check if file already has frontmatter
      if (content.startsWith('---')) {
        console.log(`File ${filePath} already has frontmatter, validating...`);
        const frontmatter = await extractFrontmatter(content);
        if (frontmatter) {
          const validationResult = this.templateRegistry.validate(filePath, frontmatter);
          if (!validationResult.valid) {
            reportValidationErrors(filePath, validationResult);
          } else {
            console.log(`Frontmatter in ${filePath} is valid`);
          }
        }
        return;
      }
      
      // Generate frontmatter from template
      const frontmatter = await this.templateRegistry.applyTemplate(filePath);
      
      if (frontmatter) {
        await insertFrontmatter(filePath, frontmatter);
      } else {
        console.log(`No template found for ${filePath}, skipping frontmatter insertion`);
      }
    } catch (error) {
      console.error(`Error processing new file ${filePath}:`, error);
    }
  }
  
  /**
   * Handle a file change event
   * @param filePath The path to the changed file
   */
  async onFileChange(filePath: string): Promise<void> {
    try {
      // Read the file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Extract frontmatter
      const frontmatter = await extractFrontmatter(content);
      
      if (frontmatter) {
        // Validate against template
        const validationResult = this.templateRegistry.validate(filePath, frontmatter);
        
        if (!validationResult.valid) {
          reportValidationErrors(filePath, validationResult);
        }
      } else {
        console.log(`No frontmatter found in ${filePath}`);
        
        // If no frontmatter, try to add it
        const template = await this.templateRegistry.applyTemplate(filePath);
        if (template) {
          await insertFrontmatter(filePath, template);
        }
      }
    } catch (error) {
      console.error(`Error processing file change ${filePath}:`, error);
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
