// /Users/mpstaton/code/lossless-monorepo/tidyverse/tidy-up/tidy-one-property/import-url-where-none/reportMissingUrls.mjs
import path from 'path';

// --- Configuration ---
const MONOREPO_ROOT = '/Users/mpstaton/code/lossless-monorepo';
const CONTENT_DIR_ROOT = path.join(MONOREPO_ROOT, 'content'); // Define root content dir

/**
 * Data structure for accumulating report data.
 * This structure will be populated by the calling script (findMissingUrls.mjs).
 */
export const report_data_accumulator = {
    summary: {
        totalFilesScanned: 0,
        filesWithFrontmatter: 0,
        filesWithoutFrontmatter: 0, // These are implicitly missing 'url:'
        filesWithReadError: 0,
        filesWithFrontmatterError: 0,
        // missingUrlCount will be derived from the length of the details array
    },
    details: {
        filesMissingUrl: [], // Array of relative file paths
    },
};

/**
 * Generates the report content in Markdown format.
 * @param {object} reportData - The populated report_data_accumulator object.
 * @returns {string} Formatted report content as a Markdown string.
 */
function generateReportContentInternal(reportData) {
    const timestamp = new Date().toISOString();
    const { summary, details } = reportData;
    const missingUrlCount = details.filesMissingUrl.length;

    // Format the list of files using Obsidian backlinks, NO headers
    const fileList = details.filesMissingUrl
        .map(relativePathFromRoot => {
            // Ensure we handle potential path separator differences if necessary
            const fullPath = path.join(MONOREPO_ROOT, relativePathFromRoot);
            const relativePathFromContent = path.relative(CONTENT_DIR_ROOT, fullPath);
            const fileName = path.basename(relativePathFromRoot, '.md');
            // Check if relativePathFromContent is empty or just '.', which can happen
            // if the file is directly in CONTENT_DIR_ROOT (unlikely for tooling but possible)
            const obsidianPath = relativePathFromContent && relativePathFromContent !== '.' ? relativePathFromContent : fileName;
            const backlink = `[[${obsidianPath}|${fileName}]]`;
            // Return just the backlink as a list item
            return `- ${backlink}`;
        })
        .join('\n'); // Separate entries with a newline

    // Construct the full report content
    return `---
report_title: "Files Missing 'url:' Property Report"
date_generated: "${timestamp}"
tags:
- YAML-Validation
- Data-Integrity
- URL-Properties
- Missing-Data
---

## Summary
- Total files scanned: ${summary.totalFilesScanned}
- Files with frontmatter: ${summary.filesWithFrontmatter}
- Files without frontmatter (implicitly missing 'url:'): ${summary.filesWithoutFrontmatter}
- Files missing 'url:' property (Total): ${missingUrlCount}
- Files with read errors: ${summary.filesWithReadError}
- Files with frontmatter extraction errors: ${summary.filesWithFrontmatterError}

## Details

### Files Missing the 'url:' Property:
${fileList || "No files found missing the 'url:' property."}
`;
}

/**
 * Generates the report content as a Markdown string based on the accumulated data.
 * This function no longer writes the file.
 * @param {object} reportData - The populated report_data_accumulator object.
 * @returns {string} The formatted report content as a Markdown string.
 */
export function generateMissingUrlReportContent(reportData) {
    try {
        // Generate the actual report content using the internal function
        const reportContent = generateReportContentInternal(reportData);
        return reportContent;
    } catch (error) {
        console.error('\nError generating report content:', error);
        // Decide if this error should halt the overall process
        // Return an error message or empty string, or rethrow
        // Depending on how the caller should handle generation errors
        return `Error generating report: ${error.message}`;
    }
}
