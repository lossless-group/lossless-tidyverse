// /Users/mpstaton/code/lossless-monorepo/tidyverse/tidy-up/tidy-one-property/import-url-where-none/findMissingUrls.mjs
import fs from 'fs/promises';
import path from 'path';
// Import the shared helper function
import { extractFrontmatter } from '../helperFunctions.cjs'; // Adjusted path
// Import the accumulator and the *renamed* content generation function
import { report_data_accumulator, generateMissingUrlReportContent } from './reportMissingUrls.mjs';
// Import the shared report writing function from utils
import { writeReport as writeSharedReport } from '../../utils/reportUtils.cjs'; // Adjusted path to utils

// --- Configuration ---
const MONOREPO_ROOT = '/Users/mpstaton/code/lossless-monorepo';
const TARGET_DIR_RELATIVE = 'content/tooling'; // Directory to scan

// Construct absolute paths
const TARGET_DIR_ABSOLUTE = path.join(MONOREPO_ROOT, TARGET_DIR_RELATIVE);

// Regex to find 'url:' at the start of a line within the frontmatter
const urlPropertyRegex = /^\s*url:/m;
// --- End Configuration ---

/**
 * Recursively finds all .md files in a directory.
 * @param {string} dir - The directory path to search.
 * @returns {Promise<string[]>} A promise that resolves with an array of absolute file paths.
 */
async function findMdFiles(dir) {
    let results = [];
    try {
        const list = await fs.readdir(dir, { withFileTypes: true });
        for (const dirent of list) {
            const res = path.resolve(dir, dirent.name);
            if (dirent.isDirectory()) {
                results = results.concat(await findMdFiles(res)); // Recurse into subdirectories
            } else if (dirent.isFile() && res.endsWith('.md')) {
                results.push(res); // Add .md files
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    return results;
}

/**
 * Main function to find files missing the 'url:' property within their frontmatter
 * and write the list of such files to a file.
 */
async function findAndReportMissingUrls() {
    console.log(`Starting scan in: ${TARGET_DIR_ABSOLUTE}`);
    // Use the imported accumulator
    const accumulator = report_data_accumulator;
    accumulator.details.filesMissingUrl = []; // Ensure it's empty before starting
    // Reset counts
    accumulator.summary.totalFilesScanned = 0;
    accumulator.summary.filesWithFrontmatter = 0;
    accumulator.summary.filesWithoutFrontmatter = 0;
    accumulator.summary.filesWithReadError = 0;
    accumulator.summary.filesWithFrontmatterError = 0;

    try {
        const allMdFiles = await findMdFiles(TARGET_DIR_ABSOLUTE);

        // Process each file
        await Promise.all(allMdFiles.map(async (filePath) => {
            const relativePath = path.relative(MONOREPO_ROOT, filePath);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                accumulator.summary.totalFilesScanned++;

                // Use the shared function to extract frontmatter
                const fmResult = extractFrontmatter(content);

                if (!fmResult.success) {
                    accumulator.summary.filesWithFrontmatterError++;
                    console.warn(`WARN: Error extracting frontmatter from ${relativePath}: ${fmResult.error}`);
                    return; // Skip this file if frontmatter extraction failed
                }

                if (fmResult.noFrontmatter) {
                    accumulator.summary.filesWithoutFrontmatter++;
                    // File has no frontmatter block, so it's definitely missing the url property
                    accumulator.details.filesMissingUrl.push(relativePath);
                    return; // Move to the next file
                }

                accumulator.summary.filesWithFrontmatter++;
                // Check if the 'url:' property exists *within the extracted frontmatter string*
                if (!urlPropertyRegex.test(fmResult.frontmatterString)) {
                    accumulator.details.filesMissingUrl.push(relativePath);
                }

            } catch (readError) {
                accumulator.summary.filesWithReadError++;
                console.error(`ERROR: Reading file ${relativePath}:`, readError);
            }
        }));

        accumulator.details.filesMissingUrl.sort();

        // --- Updated Reporting Logic ---
        // 1. Generate the report content string using the specific generator
        const reportContent = generateMissingUrlReportContent(accumulator);

        // 2. Write the content string to a file using the shared, indexed writer
        // Provide a descriptive prefix for the filename.
        await writeSharedReport(reportContent, 'missing-url-properties');
        // --- End Updated Reporting Logic ---

    } catch (error) {
        console.error('\nError during the process:', error);
        process.exit(1); // Exit with an error code
    }
}

// --- Execute Script ---
findAndReportMissingUrls();
// --- End Execute Script ---
