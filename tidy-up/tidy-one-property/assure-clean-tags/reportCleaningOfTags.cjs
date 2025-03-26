const fs = require('fs').promises;
const path = require('path');

/**
 * Get the next available index for today's reports
 * @param {string} reportsDir - Directory containing reports
 * @param {string} baseFilename - Base filename without index
 * @returns {Promise<number>} Next available index
 */
async function getNextReportIndex(reportsDir, baseFilename) {
    try {
        const files = await fs.readdir(reportsDir);
        const today = new Date().toISOString().split('T')[0];
        const pattern = new RegExp(`^${today}_${baseFilename}_(\\d+)\\.md$`);
        
        let maxIndex = 0;
        files.forEach(file => {
            const match = file.match(pattern);
            if (match) {
                const index = parseInt(match[1]);
                maxIndex = Math.max(maxIndex, index);
            }
        });
        
        return maxIndex + 1;
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(reportsDir, { recursive: true });
            return 1;
        }
        throw error;
    }
}

/**
 * Format a file path into wiki-link format
 * @param {string} filePath - Path to format
 * @returns {string} Formatted path
 */
function formatFilePath(filePath) {
    const contentIndex = filePath.indexOf('content/');
    const relativePath = filePath.slice(contentIndex + 8);
    const parts = relativePath.split('/');
    parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const fileName = path.basename(filePath);
    return `[[${parts.join('/')}|${fileName}]]`;
}

/**
 * Generate a report for the tag cleaning operation
 * @param {Object} data - Report data
 * @returns {Promise<string>} Path to the generated report
 */
async function generateCleaningReport(data) {
    const reportsDir = path.join(__dirname, '../../../../content/reports');
    const baseFilename = 'tag-cleaning-report';
    const index = await getNextReportIndex(reportsDir, baseFilename);
    const reportPath = path.join(reportsDir, `${new Date().toISOString().split('T')[0]}_${baseFilename}_${String(index).padStart(2, '0')}.md`);
    
    let report = `---
title: ${data.title}
date_created: ${data.date}
category: Reports
tags:
  - Tidy-Data
  - Scripts
  - YAML-Frontmatter
  - Automation
---

# ${data.title}

## Summary
- Total files processed: ${data.results.detection.totalFiles}
- Files with irregularities: ${data.results.detection.irregularFiles.length}
- Files cleaned: ${data.results.cleaning.filter(r => r.modified).length}

## Detection Results
`;

    data.results.detection.irregularFiles.forEach(file => {
        report += `### ${formatFilePath(file.file)}\n`;
        report += `* Line ${file.lineNumber}: \`${file.line}\`\n`;
        report += `* Issues: ${file.issues.join(', ')}\n\n`;
    });

    report += `\n## Cleaning Results\n`;
    data.results.cleaning.forEach(result => {
        report += `### ${formatFilePath(result.file)}\n`;
        report += `* Modified: ${result.modified}\n`;
        if (result.backupCreated) {
            report += `* Backup created: Yes\n`;
        }
        if (result.error) {
            report += `* Error: ${result.error}\n`;
        }
        report += '\n';
    });

    await fs.writeFile(reportPath, report);
    return reportPath;
}

module.exports = { generateCleaningReport };