/**
 * addDateCreated - Ensures a canonical date_created field in frontmatter.
 *
 * If date_created is missing or invalid, sets it to the file's filesystem birthtime (YYYY-MM-DD string).
 *
 * @param frontmatter - The frontmatter object to update
 * @param filePath - The file path (for logging and stat)
 * @returns { changes: { date_created: string } | {} } Only returns changed fields
 */
import fs from 'fs';
import path from 'path';

export function addDateCreated(frontmatter: Record<string, any>, filePath: string) {
  // Aggressive commenting: This function is called by the propertyCollector in fileSystemObserver.ts
  // All call sites must be listed here:
  // - fileSystemObserver.ts: propertyCollector pipeline for Markdown files

  // Only add date_created if missing or invalid
  const hasValidDate = typeof frontmatter.date_created === 'string' && !isNaN(Date.parse(frontmatter.date_created));
  if (!hasValidDate) {
    try {
      const stat = fs.statSync(filePath);
      // Use birthtime as canonical creation date, formatted as YYYY-MM-DD
      const birth = stat.birthtime;
      const dateCreated = `${birth.getFullYear()}-${String(birth.getMonth()+1).padStart(2,'0')}-${String(birth.getDate()).padStart(2,'0')}`;
      return { changes: { date_created: dateCreated } };
    } catch (err) {
      console.error(`[addDateCreated] Error reading file stats for ${filePath}:`, err);
      // Do not throw, just skip
      return { changes: {} };
    }
  }
  // No changes needed
  return { changes: {} };
}

/**
 * List of all call sites for addDateCreated:
 * - fileSystemObserver.ts: propertyCollector pipeline (onChange handler)
 */
