#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Import constants and utility functions
const { CONTENT_TOOLING_DIR } = require('./utils/constants.cjs');
const { formatRelativePath, writeReport } = require('./utils/reportUtils.cjs');

/**
 * Check frontmatter for formatting issues:
 * 1. Tags ending with '---'
 * 2. Multiple blank lines before closing delimiter
 */
async function checkFrontmatterFormatting(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        let inFrontmatter = false;
        let frontmatterCount = 0;
        let lastContentLineIndex = -1;
        let issues = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Track frontmatter boundaries
            if (line === '---') {
                frontmatterCount++;
                if (frontmatterCount === 1) {
                    inFrontmatter = true;
                } else if (frontmatterCount === 2) {
                    // Check for multiple blank lines before closing delimiter
                    const blankLineCount = i - lastContentLineIndex - 1;
                    if (blankLineCount > 1) {
                        issues.push({
                            type: 'extra_blank_lines',
                            details: `${blankLineCount} blank lines before closing delimiter`,
                            lineNumber: i
                        });
                    }
                    break;
                }
                continue;
            }

            if (inFrontmatter && line) {
                lastContentLineIndex = i;
                
                // Check for tags ending with ---
                if (line.startsWith('  -') && line.endsWith('---')) {
                    issues.push({
                        type: 'invalid_tag_ending',
                        details: `Tag ends with '---': ${line}`,
                        lineNumber: i + 1
                    });
                }
            }
        }

        return {
            file: filePath,
            hasIssues: issues.length > 0,
            issues
        };

    } catch (error) {
        return {
            file: filePath,
            hasIssues: true,
            issues: [{
                type: 'error',
                details: error.message
            }]
        };
    }
}

async function processDirectory(directory) {
    const results = [];
    
    async function processFile(filePath) {
        if (path.extname(filePath) === '.md') {
            const result = await checkFrontmatterFormatting(filePath);
            if (result.hasIssues) {
                results.push(result);
            }
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

/**
 * Generates the report content string (does not write the file).
 * @param {Array} results - Array of issue objects from checkFrontmatterFormatting.
 * @returns {string} The formatted Markdown report string.
 */
function generateReportString(results) {
    let report = '# Frontmatter Format Issues Report\n\n';
    report += '## Summary\n';
    report += `- Files with issues: ${results.length}\n\n`;

    report += '## Files with Issues\n';
    results.forEach(result => {
        // Use formatRelativePath for standardized plain text relative paths
        const relativePath = formatRelativePath(result.file);
        // List file using plain text path, not header or backlink
        report += `\n**${relativePath}**\n`;
        result.issues.forEach(issue => {
            if (issue.lineNumber) {
                report += `- Line ${issue.lineNumber}: ${issue.type} - ${issue.details}\n`;
            } else {
                report += `- ${issue.type} - ${issue.details}\n`;
            }
        });
    });

    return report;
}

async function main() {
    console.log('Checking frontmatter formatting...');
    // Use CONTENT_TOOLING_DIR constant
    const results = await processDirectory(CONTENT_TOOLING_DIR);

    if (results.length > 0) {
        // Generate the report string
        const reportContent = generateReportString(results);
        // Write the report using the utility function
        await writeReport(reportContent, 'frontmatter-format');
    } else {
        console.log('No frontmatter formatting issues found.');
    }
}

main().catch(console.error);
