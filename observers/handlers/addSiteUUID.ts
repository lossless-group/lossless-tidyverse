/**
 * addSiteUUID - Adds a UUID v4 to the frontmatter if not present.
 *
 * @param frontmatter - The frontmatter object to update
 * @param filePath - The file path (for logging)
 * @returns The updated frontmatter object
 */
import { generateUUID } from '../utils/commonUtils';
import { isEnabledForPath } from '../utils/commonUtils';

/**
 * evaluateSiteUUID - Determines if a site_uuid should be added to the frontmatter.
 *
 * @param frontmatter - The frontmatter object to check
 * @param filePath - The file path (for logging)
 * @returns An object with expectSiteUUID boolean
 */
export function evaluateSiteUUID(frontmatter: Record<string, any>, filePath: string): { expectSiteUUID: boolean } {
  // Logging for traceability
  console.log(`[evaluateSiteUUID] file: ${filePath}`);
  const needsUUID = !frontmatter.site_uuid || typeof frontmatter.site_uuid !== 'string' || frontmatter.site_uuid.length < 12;
  if (needsUUID) {
    console.log(`[evaluateSiteUUID] site_uuid is missing or invalid.`);
  } else {
    console.log(`[evaluateSiteUUID] site_uuid present.`);
  }
  return { expectSiteUUID: needsUUID };
}

export function addSiteUUID(frontmatter: Record<string, any>, filePath: string) {
  // Aggressive ON/OFF logic: skip if addSiteUUID is disabled for this path
  if (!isEnabledForPath(filePath, 'addSiteUUID')) {
    console.log(`[addSiteUUID] Disabled for ${filePath} (via userOptionsConfig)`);
    return { changes: {} };
  }
  // Only add site_uuid if missing or invalid
  const hasValidUUID = typeof frontmatter.site_uuid === 'string' && /^[0-9a-fA-F-]{36}$/.test(frontmatter.site_uuid);
  if (!hasValidUUID) {
    const newUUID = generateUUID();
    return { changes: { site_uuid: newUUID } };
  }
  // No changes needed
  return { changes: {} };
}
