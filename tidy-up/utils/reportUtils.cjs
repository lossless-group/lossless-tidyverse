const fs = require('fs').promises;
const path = require('path');
const { CONTENT_ROOT, REPORTS_DIR } = require('./constants.cjs');

// =============================================================================
// Reporting Utility Functions
// =============================================================================
// Provides standardized functions for report generation and file path formatting.
// -----------------------------------------------------------------------------

/**
 * Formats an absolute file path into a plain text path relative to the CONTENT_ROOT.
 * This format is mandatory for listing files in reports.
 * Example: /Users/name/repo/content/tooling/file.md -> tooling/file.md
 *
 * @param {string} absoluteFilePath - The full, absolute path to the file.
 * @returns {string} The file path relative to CONTENT_ROOT, or the original absolute path if it's not within CONTENT_ROOT.
 */
function formatRelativePath(absoluteFilePath) {
  if (!absoluteFilePath) {
    return ''; // Return empty string for undefined/null input
  }
  try {
    // Check if the path is actually within the CONTENT_ROOT
    const relativePath = path.relative(CONTENT_ROOT, absoluteFilePath);
    // path.relative returns '../...' if the path is outside the base
    if (relativePath.startsWith('..')) {
      console.warn(`⚠️ Path ${absoluteFilePath} is outside CONTENT_ROOT. Returning original path.`);
      return absoluteFilePath; // Or perhaps just path.basename(absoluteFilePath)?
    }
    return relativePath;
  } catch (error) {
    console.error(`❌ Error formatting relative path for ${absoluteFilePath}:`, error);
    return absoluteFilePath; // Return original path on error
  }
}

/**
 * Writes the provided report content to a timestamped file in the standard REPORTS_DIR.
 * Ensures the REPORTS_DIR exists before writing.
 *
 * @param {string} reportContent - The full Markdown content of the report.
 * @param {string} reportNamePrefix - A descriptive prefix for the report filename (e.g., 'frontmatter-fix', 'asset-conversion').
 * @returns {Promise<string>} A promise that resolves with the absolute path of the saved report file.
 * @throws {Error} If writing the file fails.
 */
async function writeReport(reportContent, reportNamePrefix) {
  try {
    // Ensure the reports directory exists
    await fs.mkdir(REPORTS_DIR, { recursive: true });

    // Get current date in YYYY-MM-DD format
    const date = new Date().toISOString().split('T')[0];

    // -- Start: Indexed Filename Logic --
    let reportFilePath;
    let index = 0;
    const baseFilename = `${date}_${reportNamePrefix}_report`;
    const extension = '.md';

    // Loop to find the next available filename index
    while (true) {
      const suffix = index === 0 ? '' : `_${String(index).padStart(2, '0')}`; // _01, _02...
      const currentFilename = `${baseFilename}${suffix}${extension}`;
      reportFilePath = path.join(REPORTS_DIR, currentFilename);

      try {
        await fs.access(reportFilePath); // Check if file exists
        index++; // If it exists, increment index and try again
      } catch (err) {
        // If fs.access throws (ENOENT), the file doesn't exist, so we use this path
        if (err.code === 'ENOENT') {
          break; // Found an available filename
        } else {
          throw err; // Rethrow other errors
        }
      }
    }
    // -- End: Indexed Filename Logic --

    // Write the report file
    await fs.writeFile(reportFilePath, reportContent, 'utf8');
    console.log(`✅ Report successfully saved to: ${reportFilePath}`);
    return reportFilePath;
  } catch (error) {
    console.error(`❌ Error writing report file for prefix '${reportNamePrefix}':`, error);
    throw error; // Re-throw the error for the calling script to handle
  }
}

// =============================================================================
// Exports
// =============================================================================
module.exports = {
  formatRelativePath,
  writeReport
};
