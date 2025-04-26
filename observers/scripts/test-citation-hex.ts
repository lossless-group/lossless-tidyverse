#!/usr/bin/env ts-node

/**
 * Test script for citation hex formatter
 *
 * This script is a thin wrapper around the canonical logic in citationService.ts.
 * It processes a single Markdown file using the project's single source of truth for citation handling.
 */

import { processCitations } from '../services/citationService';
import * as fs from 'fs/promises';

// -----------------------------
// Main CLI Entrypoint
// -----------------------------
async function main() {
  // Get file path from command line arguments
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Please provide a file path as an argument');
    process.exit(1);
  }

  try {
    // Read the Markdown file
    const content = await fs.readFile(filePath, 'utf8');

    // Optionally customize config here (using default for now)
    // const customConfig: CitationConfig = { ... };

    // Use canonical citation logic from the service
    const result = await processCitations(content, filePath /*, customConfig */);

    // Write updated content if changes were made
    if (result.changed) {
      await fs.writeFile(filePath, result.updatedContent, 'utf8');
      console.log(`File updated: ${filePath}`);
    } else {
      console.log(`No changes needed for: ${filePath}`);
    }

    // Print processing statistics
    console.log('Statistics:', result.stats);
  } catch (error) {
    console.error('Error processing file:', error);
    process.exit(1);
  }
}

main();
