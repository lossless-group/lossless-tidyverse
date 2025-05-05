/**
 * Script: list-and-fix-duplicate-properties.ts
 * --------------------------------------------
 * Scans all prompt Markdown files for duplicate site_uuid values.
 * Optionally, can fix duplicates by generating new UUIDs for all but one file per duplicate value.
 *
 * Uses shared observer utilities for reading/writing frontmatter and reporting.
 *
 * Usage: pnpm tsx tidyverse/observers/scripts/list-and-fix-duplicate-properties.ts
 *
 * Aggressive, comprehensive, continuous commenting throughout.
 */

import path from 'path';
import fs from 'fs/promises';
import { extractFrontmatter, writeFrontmatterToFile } from '../utils/yamlFrontmatter';
import { generateUUID } from '../utils/commonUtils';
import { ReportingService } from '../services/reportingService';

// --- CONFIGURATION: Directory to scan ---
const PROMPTS_DIR = path.resolve(__dirname, '../../../content/lost-in-public/prompts');

// --- Initialize reporting service ---
const reportingService = new ReportingService(PROMPTS_DIR);

/**
 * Recursively find all Markdown files in a directory.
 * @param dir Directory to search
 * @returns Array of absolute file paths
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  let results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await findMarkdownFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Main logic: Find and optionally fix duplicate site_uuid values.
 */
async function main() {
  const mdFiles = await findMarkdownFiles(PROMPTS_DIR);
  const uuidToFiles: Record<string, string[]> = {};
  const fileToFrontmatter: Record<string, any> = {};

  // --- Scan all files and build site_uuid map ---
  for (const filePath of mdFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    if (!frontmatter || !frontmatter.site_uuid) continue;
    const uuid = frontmatter.site_uuid;
    fileToFrontmatter[filePath] = frontmatter;
    if (!uuidToFiles[uuid]) uuidToFiles[uuid] = [];
    uuidToFiles[uuid].push(filePath);
  }

  // --- Detect duplicates ---
  let duplicatesFound = false;
  for (const [uuid, files] of Object.entries(uuidToFiles)) {
    if (files.length > 1) {
      duplicatesFound = true;
      console.log(`\n[DUPLICATE] site_uuid: ${uuid}`);
      files.forEach(f => console.log(`  - ${f}`));
      reportingService.logValidation(files[0], {
        valid: false,
        errors: [{
          field: 'site_uuid',
          message: `Duplicate site_uuid value found in ${files.length} files.`,
          value: uuid
        }],
        warnings: [],
        suggestedFixes: undefined
      });
    }
  }

  if (!duplicatesFound) {
    console.log('\n[OK] No duplicate site_uuid values found.');
    return;
  }

  // --- Optional: Fix duplicates by assigning new UUIDs to all but the first file per duplicate ---
  // Uncomment the following block to enable auto-fix:
  for (const [uuid, files] of Object.entries(uuidToFiles)) {
    if (files.length > 1) {
      // Keep the first file's UUID, fix the rest
      for (let i = 1; i < files.length; i++) {
        const filePath = files[i];
        const frontmatter = fileToFrontmatter[filePath];
        const newUUID = generateUUID();
        frontmatter.site_uuid = newUUID;
        await writeFrontmatterToFile(filePath, frontmatter);
        console.log(`[FIXED] Assigned new site_uuid to ${filePath}: ${newUUID}`);
        reportingService.logFieldAdded(filePath, 'site_uuid', newUUID);
      }
    }
  }

  // --- Write a validation report ---
  await reportingService.writeReport();
  console.log('\n[REPORT] Duplicate site_uuid report written.');
}

main().catch(err => {
  console.error('[ERROR] Failed to complete duplicate site_uuid scan:', err);
});