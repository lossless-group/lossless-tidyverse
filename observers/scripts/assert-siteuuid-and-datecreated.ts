/**
 * assert-siteuuid-and-datecreated.ts
 * ---------------------------------
 * Script to assert that every Markdown file in the content directory has:
 *   - a valid site_uuid (using addSiteUUID)
 *   - a canonical date_created (using addDateCreated, formatted as YYYY-MM-DD)
 *
 * This script does NOT run as part of the observer/watchers system.
 * It is a one-off batch utility for initial remediation.
 *
 * Usage: pnpm tsx tidyverse/observers/scripts/assert-siteuuid-and-datecreated.ts
 *
 * Aggressive, comprehensive, continuous commenting throughout.
 *
 * Project rules strictly followed: NO changes to directory structure, NO new dependencies.
 */

import fs from 'fs';
import path from 'path';
import { addSiteUUID } from '../handlers/addSiteUUID';
import { addDateCreated } from '../handlers/addDateCreated';
import { extractFrontmatter, writeFrontmatterToFile, formatFrontmatter } from '../utils/yamlFrontmatter';
// Removed unused imports: generateUUID, getFileCreationDate

// === CONFIGURATION: Root content directory (adjust as needed) ===
const CONTENT_ROOT = path.resolve(__dirname, '../../../content/essays');
console.log(`[INFO] Processing only: ${CONTENT_ROOT}`);

/**
 * Recursively find all Markdown files in a directory.
 * @param dir Directory to search
 * @returns Array of absolute file paths
 */
function findMarkdownFiles(dir: string): string[] {
  let results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findMarkdownFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Main batch assertion logic.
 * For each Markdown file:
 *   - Extract frontmatter
 *   - Assert site_uuid and date_created
 *   - If changes are needed, write updated frontmatter
 */
async function main() {
  const mdFiles = findMarkdownFiles(CONTENT_ROOT);
  let updatedCount = 0;
  for (const filePath of mdFiles) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = extractFrontmatter(fileContent);
      if (!frontmatter) {
        // === No frontmatter found: create new block with site_uuid and date_created ===
        // Aggressive, comprehensive, continuous commenting:
        // - Generate new UUID (v4) for site_uuid using addSiteUUID
        // - Get file birthtime for date_created using addDateCreated
        // - Compose new frontmatter object, do NOT assert title (per user instruction)
        // - Insert as YAML frontmatter at the very top, followed by the original content
        const newUUID = addSiteUUID({}, filePath).changes.site_uuid;
        const dateCreated = addDateCreated({}, filePath).changes.date_created;
        const newFrontmatter = {
          site_uuid: newUUID,
          date_created: dateCreated || ''
        };
        // Format as YAML frontmatter block
        const yamlBlock = `---\n${formatFrontmatter(newFrontmatter)}---\n\n`;
        // Write new content to file (prepend frontmatter)
        fs.writeFileSync(filePath, yamlBlock + fileContent, 'utf-8');
        updatedCount++;
        console.log(`[ADDED FRONTMATTER] ${filePath} ->`, newFrontmatter);
        continue;
      }
      // --- Assert site_uuid ---
      const siteUUIDResult = addSiteUUID(frontmatter, filePath);
      // --- Assert date_created ---
      const dateCreatedResult = addDateCreated(frontmatter, filePath);
      // --- Merge changes ---
      const changes = { ...siteUUIDResult.changes, ...dateCreatedResult.changes };
      if (Object.keys(changes).length > 0) {
        const newFrontmatter = { ...frontmatter, ...changes };
        await writeFrontmatterToFile(filePath, newFrontmatter);
        updatedCount++;
        console.log(`[UPDATED] ${filePath} ->`, changes);
      }
    } catch (err) {
      console.error(`[ERROR] Failed to process ${filePath}:`, err);
    }
  }
  console.log(`\n[SUMMARY] Updated ${updatedCount} file(s) with missing site_uuid and/or date_created.`);
}

main();
