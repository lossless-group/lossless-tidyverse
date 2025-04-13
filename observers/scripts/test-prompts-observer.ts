/**
 * Test script for the prompts directory observer
 * 
 * This script initializes the FileSystemObserver with the prompts template
 * and watches the prompts directory for changes.
 */

import { FileSystemObserver } from '../../../site_archive/fileSystemObserver';
import { TemplateRegistry } from '../services/templateRegistry';
import { ReportingService } from '../services/reportingService';
import * as path from 'path';

// Set up the content root path
// This should be the root of the content directory
const contentRoot = path.resolve(__dirname, '../../../content');

// Create a reporting service
const reportingService = new ReportingService(contentRoot);

// Create a template registry
const templateRegistry = new TemplateRegistry();

// Create a file system observer
const observer = new FileSystemObserver(
  templateRegistry,
  reportingService,
  contentRoot,
  {
    ignoreInitial: false,       // Process existing files on startup
    processExistingFiles: true, // Process all existing files
    initialProcessingDelay: 90000 // 90 seconds delay before switching to regular mode
  }
);

// Start watching
observer.startWatching();

console.log('Observer started with 90 second initial processing window. Press Ctrl+C to stop.');
console.log('During this time, existing files will be processed but new changes won\'t trigger the observer.');
console.log('After 90 seconds, the observer will switch to regular mode and watch for file changes.');

// Handle process termination
process.on('SIGINT', () => {
  console.log('Stopping observer...');
  observer.stopWatching();
  process.exit(0);
});

// Generate a final report on exit
process.on('exit', () => {
  console.log('Generating final report...');
  reportingService.generateReport();
});
