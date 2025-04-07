/**
 * Frontmatter Observer Main Entry Point
 * 
 * This script initializes and runs the filesystem observer to monitor
 * the content/tooling directory for changes and ensure frontmatter consistency.
 * 
 * Usage:
 *   ts-node index.ts
 */

import * as path from 'path';
import { FileSystemObserver } from './fileSystemObserver';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';

/**
 * Main function to initialize and start the observer
 */
async function main() {
  console.log('Starting Frontmatter Observer...');
  
  // Initialize template registry
  const templateRegistry = new TemplateRegistry();
  
  // Initialize reporting service
  const reportingService = new ReportingService(process.cwd());
  
  // Determine content root path
  // This assumes the script is run from the tidyverse/observers directory
  const contentRoot = path.resolve(process.cwd(), '../../content/tooling');
  console.log(`Content root: ${contentRoot}`);
  
  // Create and start file system observer
  const observer = new FileSystemObserver(templateRegistry, reportingService, contentRoot);
  observer.startWatching();
  
  console.log('Observer started. Press Ctrl+C to exit.');
  
  // Generate an initial report after 10 seconds to capture startup activity
  setTimeout(async () => {
    try {
      const reportPath = await reportingService.writeReport();
      console.log(`Generated initial report: ${reportPath}`);
    } catch (error) {
      console.error('Error generating initial report:', error);
    }
  }, 10000);
  
  // Set up periodic report generation (every 5 minutes)
  const reportInterval = 5 * 60 * 1000; // 5 minutes in milliseconds
  setInterval(async () => {
    try {
      const reportPath = await reportingService.writeReport();
      console.log(`Generated periodic report: ${reportPath}`);
    } catch (error) {
      console.error('Error generating report:', error);
    }
  }, reportInterval);
  
  // Generate a report on shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down observer...');
    
    try {
      const reportPath = await reportingService.writeReport();
      console.log(`Generated final report: ${reportPath}`);
    } catch (error) {
      console.error('Error generating final report:', error);
    }
    
    observer.stopWatching();
    process.exit(0);
  });
}

// Run the main function
main().catch(error => {
  console.error('Error running frontmatter observer:', error);
  process.exit(1);
});
