/**
 * addSiteUUID - Adds a UUID v4 to the frontmatter if not present.
 *
 * @param frontmatter - The frontmatter object to update
 * @param filePath - The file path (for logging)
 * @returns The updated frontmatter object
 */
import { generateUUID } from '../utils/commonUtils';

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
  console.log(`[addSiteUUID] file: ${filePath}`);
  console.log(`[addSiteUUID] frontmatter before:`, JSON.stringify(frontmatter, null, 2));
  if (!frontmatter.site_uuid) {
    frontmatter.site_uuid = generateUUID();
    console.log(`[addSiteUUID] site_uuid added:`, frontmatter.site_uuid);
    console.log(`[addSiteUUID] frontmatter after:`, JSON.stringify(frontmatter, null, 2));
  } else {
    console.log(`[addSiteUUID] site_uuid already present, no change.`);
  }
  return frontmatter;
}
