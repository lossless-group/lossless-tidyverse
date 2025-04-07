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
import * as dotenv from 'dotenv';
import { FileSystemObserver } from './fileSystemObserver';
import { TemplateRegistry } from './services/templateRegistry';
import { ReportingService } from './services/reportingService';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Main function to initialize and start the observer
 */
async function main() {
  console.log('Starting Frontmatter Observer...');
  
  // Check for OpenGraph API key
  if (!process.env.OPEN_GRAPH_IO_API_KEY) {
    console.warn('⚠️ OPEN_GRAPH_IO_API_KEY environment variable not set. OpenGraph fetching will be disabled.');
    console.warn('Create a .env file in the tidyverse directory with OPEN_GRAPH_IO_API_KEY=your_api_key_here');
  } else {
    console.log('✅ OpenGraph API key found. OpenGraph fetching is enabled.');
  }
  
  // Initialize template registry
  const templateRegistry = new TemplateRegistry();
  
  // Initialize reporting service with proper reports directory
  const reportsDir = path.resolve(process.cwd(), '../../content/reports');
  const reportingService = new ReportingService(reportsDir);
  console.log(`Reports directory: ${reportsDir}`);
  
  // Determine content root path
  // This assumes the script is run from the tidyverse/observers directory
  const contentRoot = path.resolve(process.cwd(), '../../content/tooling');
  console.log(`Content root: ${contentRoot}`);
  
  // Create and start file system observer
  const observer = new FileSystemObserver(templateRegistry, reportingService, contentRoot);
  
  console.log('Observer started. Press Ctrl+C to exit.');
  
  // Handle shutdown gracefully
  process.on('SIGINT', async () => {
    console.log('Shutting down observer...');
    process.exit(0);
  });
}

// Run the main function
main().catch(error => {
  console.error('Error running frontmatter observer:', error);
  process.exit(1);
});
