#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Assuming utils are in '../../utils' relative to this script's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const utilsPath = path.resolve(__dirname, '../../utils');

// Dynamically import CJS modules from ESM
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MONOREPO_ROOT, CONTENT_ROOT, REPORTS_DIR } = require(path.join(utilsPath, 'constants.cjs'));
const { formatRelativePath, writeReport } = require(path.join(utilsPath, 'reportUtils.cjs'));

// --- Configuration ---
const INPUT_REPORT_FILENAME = '2025-04-15_missing-url-report.md'; // The report listing files missing URLs
const SOURCE_REPO_RELATIVE_PATH = 'temp_old_repo'; // Relative path from MONOREPO_ROOT to the old repo
// --- End Configuration ---

// --- Path Definitions ---
const INPUT_REPORT_PATH = path.join(REPORTS_DIR, INPUT_REPORT_FILENAME);
const TARGET_BASE_DIR = CONTENT_ROOT; // Files listed in report are relative to CONTENT_ROOT
const SOURCE_DIR = path.join(MONOREPO_ROOT, SOURCE_REPO_RELATIVE_PATH, 'site', 'src', 'content', 'tooling');

// --- State Tracking ---
let filesFromReport = 0;
let targetFilesFound = 0;
let sourceFilenameMatches = 0;
let sourceUrlFoundCount = 0;
let filesUpdatedCount = 0;
let filesSkippedUrlExists = 0;
let filesSkippedNoSourceMatch = 0;
let filesSkippedNoSourceUrl = 0;
let readErrors = 0;
let writeErrors = 0;
const updatedFilesList = [];
const skippedUrlExistsList = [];
const skippedNoSourceMatchList = [];
const skippedNoSourceUrlList = [];
const errorFilesList = [];

// --- Helper Functions ---

/**
 * Recursively finds all .md files in a directory.
 * @param {string} dirPath - The directory path to scan.
 * @returns {Promise<Map<string, string>>} - A Map where key is filename, value is absolute path.
 */
async function buildFilenameIndex(dirPath) {
    const index = new Map();
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const subIndex = await buildFilenameIndex(fullPath);
                subIndex.forEach((p, f) => index.set(f, p)); // Merge maps
            } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
                if (index.has(entry.name)) {
                    console.warn(`⚠️ Duplicate filename found in source directory: ${entry.name}. Overwriting index entry.`);
                }
                index.set(entry.name, fullPath);
            }
        }
    } catch (error) {
        console.error(`❌ Error scanning source directory ${dirPath}: ${error.message}`);
        throw error; // Stop execution if source dir can't be scanned
    }
    return index;
}

/**
 * Extracts the 'url:' line from the frontmatter of a file.
 * Manually scans lines without parsing YAML.
 * @param {string} filePath - Absolute path to the source file.
 * @returns {Promise<string|null>} - The full 'url: value' line or null.
 */
async function extractUrlLine(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        let inFrontmatter = false;
        let frontmatterEnd = false;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '---') {
                if (inFrontmatter) {
                    frontmatterEnd = true; // Found the closing delimiter
                    break;
                } else {
                    inFrontmatter = true; // Found the opening delimiter
                    continue;
                }
            }
            if (inFrontmatter && !frontmatterEnd) {
                // Use regex for robustness: matches 'url:' at start of line, possibly indented
                const match = line.match(/^\s*url:\s*(.*)/);
                if (match) {
                    return line; // Return the original line as is
                }
            }
        }
    } catch (readError) {
        console.error(`❌ Error reading source file ${formatRelativePath(filePath)}: ${readError.message}`);
        // Continue processing other files, but log this error
    }
    return null; // URL not found or error reading file
}

/**
 * Inserts the urlLine into the target file content's frontmatter.
 * Manually inserts the line before the closing '---'. Checks if url exists.
 * @param {string} targetContent - The full content of the target file.
 * @param {string} urlLine - The 'url: value' line to insert.
 * @returns {string|null} - The modified content, or null if url already exists or error.
 */
function insertUrlIntoFrontmatter(targetContent, urlLine) {
    const lines = targetContent.split('\n');
    let firstDelimiterIndex = -1;
    let secondDelimiterIndex = -1;
    let urlExists = false;

    // Find delimiters and check for existing url
    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine === '---') {
            if (firstDelimiterIndex === -1) {
                firstDelimiterIndex = i;
            } else {
                secondDelimiterIndex = i;
                break; // Found both delimiters
            }
        } else if (firstDelimiterIndex !== -1 && secondDelimiterIndex === -1) {
            // Check if url: line already exists within frontmatter
             if (/^\s*url:\s*.*/.test(lines[i])) {
                urlExists = true;
                // Don't break here, we still need the secondDelimiterIndex
            }
        }
    }

    // Validate frontmatter structure
    if (firstDelimiterIndex === -1 || secondDelimiterIndex === -1) {
        console.warn(`⚠️ Malformed frontmatter (missing delimiters). Cannot insert URL.`);
        return null; // Indicate error/skip
    }

    if (urlExists) {
        // console.log(`ℹ️ URL already exists. Skipping insertion.`);
        filesSkippedUrlExists++;
        return null; // Indicate skip
    }

    // Insert the urlLine just before the closing delimiter
    lines.splice(secondDelimiterIndex, 0, urlLine);

    return lines.join('\n');
}

/**
 * Parses the input report file to get relative file paths.
 * @param {string} reportPath - Absolute path to the input report.
 * @returns {Promise<string[]>} - Array of relative file paths.
 */
async function parseInputReport(reportPath) {
    const relativePaths = [];
    try {
        const reportContent = await fs.readFile(reportPath, 'utf8');
        // Regex to find lines starting with #### followed by optional [[path|name]] or just path
        const pathRegex = /^####\s+(?:\[\[([^|]+)\|.*?\]\]|(\S+\.md))/gm;
        let match;
        while ((match = pathRegex.exec(reportContent)) !== null) {
            // Extract path from either capture group 1 (link) or 2 (plain path)
             const relPath = match[1] || match[2];
             if (relPath) {
                relativePaths.push(relPath.trim());
             }
        }
         filesFromReport = relativePaths.length;
         if (filesFromReport === 0) {
             console.warn(`⚠️ No file paths found in the input report: ${reportPath}`);
         }
    } catch (error) {
        console.error(`❌ Failed to read or parse input report ${reportPath}: ${error.message}`);
        throw error; // Stop execution if input report is invalid
    }
    return relativePaths;
}


// --- Main Processing Logic ---
async function main() {
    console.log('🚀 Starting URL import script...');

    console.log(`Source Directory: ${SOURCE_DIR}`);
    console.log(`Target Base Directory: ${TARGET_BASE_DIR}`);
    console.log(`Input Report: ${INPUT_REPORT_PATH}`);

    let sourceFileIndex;
    try {
        console.log('Building source file index...');
        sourceFileIndex = await buildFilenameIndex(SOURCE_DIR);
        console.log(`Found ${sourceFileIndex.size} unique .md filenames in source directory.`);
    } catch (error) {
        console.error(`❌ Fatal error building source index. Exiting.`);
        return;
    }

    let targetRelativePaths;
    try {
        console.log('Parsing input report...');
        targetRelativePaths = await parseInputReport(INPUT_REPORT_PATH);
         console.log(`Found ${targetRelativePaths.length} files listed in the report.`);
    } catch (error) {
        console.error(`❌ Fatal error reading input report. Exiting.`);
        return;
    }


    for (const relativeTargetPath of targetRelativePaths) {
        targetFilesFound++; // Count every file listed, even if processing fails
        const targetFilename = path.basename(relativeTargetPath);
        const absoluteTargetPath = path.join(TARGET_BASE_DIR, relativeTargetPath); // Use TARGET_BASE_DIR

        if (sourceFileIndex.has(targetFilename)) {
            sourceFilenameMatches++;
            const absoluteSourcePath = sourceFileIndex.get(targetFilename);

            const urlLine = await extractUrlLine(absoluteSourcePath);

            if (urlLine) {
                sourceUrlFoundCount++;
                let targetContent;
                try {
                    targetContent = await fs.readFile(absoluteTargetPath, 'utf8');
                } catch (readErr) {
                    console.error(`❌ Error reading target file ${relativeTargetPath}: ${readErr.message}`);
                    readErrors++;
                    errorFilesList.push(`${relativeTargetPath} (Read Error)`);
                    continue; // Skip to next file
                }

                const newContent = insertUrlIntoFrontmatter(targetContent, urlLine);

                if (newContent !== null) { // newContent is null if URL exists or malformed frontmatter
                    try {
                        await fs.writeFile(absoluteTargetPath, newContent, 'utf8');
                        console.log(`✅ Successfully inserted URL into: ${relativeTargetPath}`);
                        filesUpdatedCount++;
                        updatedFilesList.push(relativeTargetPath);
                    } catch (writeErr) {
                        console.error(`❌ Error writing target file ${relativeTargetPath}: ${writeErr.message}`);
                        writeErrors++;
                        errorFilesList.push(`${relativeTargetPath} (Write Error)`);
                    }
                } else {
                    // URL already existed or frontmatter was malformed
                    if (!skippedUrlExistsList.includes(relativeTargetPath)){ // Avoid double counting if error was logged in insert func
                        skippedUrlExistsList.push(relativeTargetPath);
                    }
                }
            } else {
                // console.log(`ℹ️ URL line not found in source file: ${formatRelativePath(absoluteSourcePath)}`);
                filesSkippedNoSourceUrl++;
                skippedNoSourceUrlList.push(relativeTargetPath);
            }
        } else {
            // console.log(`ℹ️ No matching filename found in source directory for: ${targetFilename}`);
            filesSkippedNoSourceMatch++;
            skippedNoSourceMatchList.push(relativeTargetPath);
        }
    }

    // --- Generate Final Report ---
    console.log('\n🏁 Processing complete. Generating report...');
    const reportString = `
# URL Import from Old Repo Report

**Date Run:** ${new Date().toISOString()}
**Input Report:** ${INPUT_REPORT_FILENAME}
**Source Directory Scanned:** ${formatRelativePath(SOURCE_DIR) || SOURCE_DIR}
**Target Directory:** ${formatRelativePath(TARGET_BASE_DIR) || TARGET_BASE_DIR}

## Summary

*   Files listed in input report: ${filesFromReport}
*   Target files processed (attempted): ${targetFilesFound}
*   Matching filename found in source: ${sourceFilenameMatches}
*   Source files where 'url:' property found: ${sourceUrlFoundCount}
*   Target files successfully updated with URL: ${filesUpdatedCount}
*   Files skipped (URL already existed or malformed frontmatter): ${filesSkippedUrlExists}
*   Files skipped (No matching filename in source): ${filesSkippedNoSourceMatch}
*   Files skipped (URL not found in source file): ${filesSkippedNoSourceUrl}
*   Read errors on target files: ${readErrors}
*   Write errors on target files: ${writeErrors}

---

## Files Successfully Updated (${updatedFilesList.length})
${updatedFilesList.map(f => `- ${f}`).join('\n')}

---

## Files Skipped - URL Already Existed or Malformed Frontmatter (${skippedUrlExistsList.length})
${skippedUrlExistsList.map(f => `- ${f}`).join('\n')}

---

## Files Skipped - No Matching Source Filename (${skippedNoSourceMatchList.length})
${skippedNoSourceMatchList.map(f => `- ${f}`).join('\n')}

---

## Files Skipped - URL Not Found in Source (${skippedNoSourceUrlList.length})
${skippedNoSourceUrlList.map(f => `- ${f}`).join('\n')}

---

## Files with Read/Write Errors (${errorFilesList.length})
${errorFilesList.map(f => `- ${f}`).join('\n')}
    `;

    try {
        const reportPrefix = 'import-url-from-old-repo';
        await writeReport(reportString, reportPrefix);
    } catch (reportError) {
        console.error(`❌ Failed to write final report: ${reportError.message}`);
    }

    console.log('\n✅ Script finished.');
}

main().catch(err => {
    console.error("\n❌ An unexpected error occurred during script execution:", err);
    process.exit(1);
});