// ================================================
// Only run audits and corrections of YAML without typical
// YAML processing modules.  If there are corruptions we get a bunch of errors. 
// The idea is to find and correct corruptions so that we can use YAML processors in live code. 
// ================================================

const fs = require('fs');
const path = require('path');
const { extractFrontmatter, createSuccessMessage, createErrorMessage } = require('../helperFunctions.cjs');

// ================================================
// Configuration by the user
// All the configuration is done in this section
// NEVER change the configuration in this section.
// ================================================

// REMOVE ALL EXTERNAL DEPENDENCIES AND CONFIG FOR CLEAN SLATE

// ================================================
// Main function to process files
// Change the name of the function in this file to something that makes sense for your desired operation.
// ================================================

async function main() {
    const markdownFiles = [];
    
    // Walk directory recursively to find all markdown files
    const walkDir = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                walkDir(fullPath);
            } else if (file.endsWith('.md')) {
                markdownFiles.push(fullPath);
            }
        }
    };

    // Use absolute path to always find the prompts directory
    const PROMPTS_DIR = "/Users/mpstaton/code/lossless-monorepo/content/lost-in-public/prompts";
    walkDir(PROMPTS_DIR);

    // Process files
    const results = await Promise.all(markdownFiles.map(async (markdownFilePath) => {
        const markdownContent = fs.readFileSync(markdownFilePath, 'utf8');
        
        // Use helper to extract frontmatter
        const frontmatterData = extractFrontmatter(markdownContent);
        if (!frontmatterData.success) {
            return createErrorMessage(markdownFilePath, frontmatterData.error);
        }
        let modified = false;
        let newFrontmatter = frontmatterData.frontmatterString;
        
        // FIND and REPLACE ALL "banner_image" keys in frontmatter (anywhere, any indentation, any quotes)
        const regex = /(^|\n)([ \t]*["']?)banner_image(["']?)\s*:/g;
        if (regex.test(newFrontmatter)) {
            newFrontmatter = newFrontmatter.replace(regex, `$1$2portrait_image$3:`);
            modified = true;
        }
        if (!modified) {
            return createSuccessMessage(markdownFilePath, false);
        }
        
        // Reassemble content using indices from helper
        const correctedContent = markdownContent.slice(0, frontmatterData.startIndex) +
            '---\n' + newFrontmatter + '\n---' +
            markdownContent.slice(frontmatterData.endIndex);
        
        // If modified and new content exists, write back to file
        if (modified && correctedContent) {
            fs.writeFileSync(markdownFilePath, correctedContent, 'utf8');
        }
        return { ...createSuccessMessage(markdownFilePath, true), content: correctedContent };
    }));

    // Generate report
    const today = new Date().toISOString().split('T')[0];
    let reportIndex = 1;
    let reportPath;
    
    do {
        const paddedIndex = String(reportIndex).padStart(2, '0');
        reportPath = `/Users/mpstaton/code/lossless-monorepo/content/reports/${today}_Convert-Banner-Key-to-Portrait-Key_${paddedIndex}.md`;
        reportIndex++;
    } while (fs.existsSync(reportPath));

    const filesProcessed = results.length;
    const namesOfFilesWithIssue = results.filter(r => r.hadIssue)
        .map(r => path.basename(r.filePath, '.md'));
    const namesOfFilesCorrected = results.filter(r => r.modified)
        .map(r => path.basename(r.filePath, '.md'));

    // Create report
    const reportTemplate = `---
title: Convert Banner Key to Portrait Key
date: ${today}
---
## Summary of Files Processed
Files processed: ${filesProcessed}
Files with issue: ${namesOfFilesWithIssue.length}
Successful corrections: ${namesOfFilesCorrected.length}

### Files with Issues
${namesOfFilesWithIssue.map(file => `[[${file}]]`).join(', ')}

### Files Successfully Corrected
${namesOfFilesCorrected.map(file => `[[${file}]]`).join(', ')}
`;

    fs.writeFileSync(reportPath, reportTemplate);
    
    // Log progress
    console.log(`
Processing complete:
- Total files processed: ${filesProcessed}
- Files with issues: ${namesOfFilesWithIssue.length}
- Files corrected: ${namesOfFilesCorrected.length}
Report written to: ${reportPath}
`);
}

// ================================================
// Run the main function
// ================================================
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});