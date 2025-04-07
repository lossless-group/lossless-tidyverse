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

/**
 * Main function to initialize and start the observer
 */
async function main() {
  console.log('Starting Frontmatter Observer...');
  
  // Initialize template registry
  const templateRegistry = new TemplateRegistry();
  
  // Determine content root path
  // This assumes the script is run from the tidyverse/observers directory
  const contentRoot = path.resolve(process.cwd(), '../../content/tooling');
  console.log(`Content root: ${contentRoot}`);
  
  // Create and start file system observer
  const observer = new FileSystemObserver(templateRegistry, contentRoot);
  observer.startWatching();
  
  console.log('Observer started. Press Ctrl+C to exit.');
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down observer...');
    observer.stopWatching();
    process.exit(0);
  });
}

// Run the main function
main().catch(error => {
  console.error('Error running frontmatter observer:', error);
  process.exit(1);
});
