/**
 * Test script for the prompts directory observer - focused version
 * 
 * This script initializes a custom observer that only watches the prompts directory
 * to make testing more focused and easier to follow.
 */

import { FileSystemObserver } from '../../../site_archive/fileSystemObserver';
import { TemplateRegistry } from '../services/templateRegistry';
import { ReportingService } from '../services/reportingService';
import * as path from 'path';
import * as chokidar from 'chokidar';

// Set up the content root path
const contentRoot = path.resolve(__dirname, '../../../content');
const promptsPath = path.join(contentRoot, 'lost-in-public/prompts');

// Create a reporting service
const reportingService = new ReportingService(contentRoot);

// Create a template registry
const templateRegistry = new TemplateRegistry();

console.log(`Report directory: ${path.resolve(contentRoot, 'reports')}`);
console.log(`Registered templates: ${Array.from(templateRegistry['templates'].keys()).join(', ')}`);
console.log(`Setting up watcher for prompts directory: ${promptsPath}`);

// Create a simple watcher for the prompts directory
const watcher = chokidar.watch(promptsPath, {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100
  }
});

// Create a file system observer for the content root
// We'll use this for processing files but not for watching
const observer = new FileSystemObserver(
  templateRegistry,
  reportingService,
  contentRoot,
  {
    ignoreInitial: true, // Don't process files on startup
    processExistingFiles: false // Don't process existing files
  }
);

// Set up event handlers for our custom watcher
watcher.on('add', async (filePath) => {
  console.log(`File added: ${filePath}`);
  if (filePath.endsWith('.md')) {
    try {
      // Use the observer's methods to process the file
      await observer['onNewFile'](filePath);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }
});

watcher.on('change', async (filePath) => {
  console.log(`File changed: ${filePath}`);
  if (filePath.endsWith('.md')) {
    try {
      // Use the observer's methods to process the file
      await observer['onFileChanged'](filePath);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }
});

console.log('Prompts Observer started. Press Ctrl+C to stop.');

// Handle process termination
process.on('SIGINT', () => {
  console.log('Stopping observer...');
  watcher.close();
  process.exit(0);
});

// Generate a final report on exit
process.on('exit', () => {
  console.log('Generating final report...');
  reportingService.generateReport();
});
