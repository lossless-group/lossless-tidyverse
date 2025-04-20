
// =============================================================================
// checkForImagePromptsBannerImage.cjs
// Reports Markdown files in `content/lost-in-public/prompts/` missing
// `image_prompt` and/or `banner_image` in YAML frontmatter, using mandatory
// reporting conventions and backlink syntax.
// =============================================================================

const fs = require('fs').promises;
const path = require('path');
const { CONTENT_ROOT } = require('../../utils/constants.cjs');
const { formatRelativePath, writeReport } = require('../../utils/reportUtils.cjs');
const { extractFrontmatter } = require('../helperFunctions.cjs');

// Directory to scan
const PROMPTS_DIR = path.join(CONTENT_ROOT, 'lost-in-public', 'prompts');

// Helper: Get all Markdown files recursively in PROMPTS_DIR
async function getMarkdownFiles(dir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await getMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Helper: Format backlink for a Markdown file (Obsidian syntax)
function formatBacklink(relPath) {
  const displayName = relPath
    .split('/')
    .pop()
    .replace(/-/g, ' ')
    .replace(/\.md$/, '')
    .replace(/\b\w/g, c => c.toUpperCase());
  return `[[${relPath}|${displayName}]]`;
}

// Helper: Check if frontmatter string contains a property (simple YAML key search)
function hasFrontmatterProp(fmString, prop) {
  // Looks for prop at the start of a line (YAML key)
  const regex = new RegExp(`^${prop}:`, 'm');
  return regex.test(fmString);
}

// Main function
(async () => {
  const files = await getMarkdownFiles(PROMPTS_DIR);
  let missingImagePrompt = [];
  let missingBannerImage = [];
  let missingBoth = [];

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const fmResult = extractFrontmatter(raw);
    const relPath = formatRelativePath(file);
    if (!fmResult.success) {
      console.error(`Error extracting frontmatter in ${file}: ${fmResult.error}`);
      continue;
    }
    if (fmResult.noFrontmatter) {
      missingBoth.push(relPath);
      continue;
    }
    const fm = fmResult.frontmatterString;
    const hasImagePrompt = hasFrontmatterProp(fm, 'image_prompt');
    const hasBannerImage = hasFrontmatterProp(fm, 'banner_image');
    if (!hasImagePrompt && !hasBannerImage) {
      missingBoth.push(relPath);
    } else {
      if (!hasImagePrompt) missingImagePrompt.push(relPath);
      if (!hasBannerImage) missingBannerImage.push(relPath);
    }
  }

  // Compose Obsidian backlink paragraphs
  const formatList = arr => arr.map(formatBacklink).join(', ');

  // Report content per reporting standards
  const date = new Date().toISOString().split('T')[0];
  const report = `---\ndate: ${date}\nauthors:\n- Michael Staton\ncategory: Data-Integrity\ntags:\n- Documentation-Standards\n- YAML\n- Prompts\n---\n\n# Missing image_prompt and/or banner_image Properties\n\n## Summary\n- Total files scanned: ${files.length}\n- Files missing both: ${missingBoth.length}\n- Files missing only image_prompt: ${missingImagePrompt.length}\n- Files missing only banner_image: ${missingBannerImage.length}\n\n## Files missing both properties\n${missingBoth.length ? formatList(missingBoth) : 'None'}\n\n## Files missing only image_prompt\n${missingImagePrompt.length ? formatList(missingImagePrompt) : 'None'}\n\n## Files missing only banner_image\n${missingBannerImage.length ? formatList(missingBannerImage) : 'None'}\n`;

  await writeReport(report, 'image-prompt-banner-image');
  console.log('Report generated.');
})();

// =============================================================================
// End of script
// =============================================================================