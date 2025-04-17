/**
 * addSiteUUID - Adds a UUID v4 to the frontmatter if not present.
 *
 * @param frontmatter - The frontmatter object to update
 * @param filePath - The file path (for logging)
 * @returns The updated frontmatter object
 */
import { generateUUID } from '../utils/commonUtils';

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
