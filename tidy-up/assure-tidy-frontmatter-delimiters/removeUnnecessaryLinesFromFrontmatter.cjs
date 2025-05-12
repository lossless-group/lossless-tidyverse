#!/usr/bin/env node

// ================================================
// Script: removeUnnecessaryLinesFromFrontmatter.cjs
// Purpose: Remove unnecessary blank or empty lines from within frontmatter of Markdown files.
// ================================================

const fs = require('fs').promises;
const path = require('path');

// ================================================
// USER OPTIONS - CONFIGURE THESE
// ================================================

// Directory to process - update as needed
const TARGET_DIR = '/Users/mpstaton/code/lossless-monorepo/content/lost-in-public/reminders';

// ================================================
// Helper: Clean frontmatter block by removing empty lines
// ================================================
async function cleanFrontmatter(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        let inFrontmatter = false;
        let frontmatterCount = 0;
        const cleanedLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Track frontmatter boundaries
            if (trimmedLine === '---') {
                frontmatterCount++;
                inFrontmatter = frontmatterCount === 1;
                cleanedLines.push(line); // Always keep delimiter
                continue;
            }

            // Only clean inside frontmatter
            if (inFrontmatter && frontmatterCount === 1) {
                // Remove empty/blank lines
                if (trimmedLine === '') {
                    continue;
                }
                cleanedLines.push(line);
            } else {
                cleanedLines.push(line);
            }

            // Exit frontmatter after second delimiter
            if (frontmatterCount === 2) {
                inFrontmatter = false;
            }
        }

        // Only write file if changed
        if (cleanedLines.join('\n') !== content) {
            await fs.writeFile(filePath, cleanedLines.join('\n'));
            return { success: true, modified: true, file: filePath };
        }
        return { success: true, modified: false, file: filePath };
    } catch (error) {
        return { success: false, error: error.message, file: filePath };
    }
}

// ================================================
// Helper: Recursively process all Markdown files in target directory
// ================================================
async function processDirectory(directory) {
    const results = [];
    async function processFile(filePath) {
        if (path.extname(filePath) === '.md') {
            const result = await cleanFrontmatter(filePath);
            results.push(result);
        }
    }
    async function walk(dir) {
        const files = await fs.readdir(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                await walk(filePath);
            } else {
                await processFile(filePath);
            }
        }
    }
    await walk(directory);
    return results;
}

// ================================================
// Main execution
// ================================================
async function main() {
    console.log('Cleaning unnecessary lines from frontmatter...');
    const results = await processDirectory(TARGET_DIR);
    const modified = results.filter(r => r.modified);
    const errors = results.filter(r => !r.success);
    console.log(`\nSummary:`);
    console.log(`Total files processed: ${results.length}`);
    console.log(`Files modified: ${modified.length}`);
    if (errors.length > 0) {
        console.log(`Files with errors: ${errors.length}`);
        errors.forEach(e => console.log(`- ${e.file}: ${e.error}`));
    }
}

main().catch(console.error);