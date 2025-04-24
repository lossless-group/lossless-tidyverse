// ================================================
// Script: assureClosingFrontmatterDelimiter.cjs
// Purpose: Ensure all Markdown files have a proper closing frontmatter delimiter (---)
//          after the last key-value pair in the frontmatter.
// ================================================

const fs = require('fs');
const path = require('path');

// ================================================
// USER OPTIONS - CONFIGURE THESE
// ================================================

// Directory to process
const TARGET_DIR = "/Users/mpstaton/code/lossless-monorepo/content/essays";

// ================================================
// Main function to process files
// ================================================

async function main() {
    const markdownFiles = [];
    // Recursively walk directory to find all markdown files
    function walkDir(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                walkDir(fullPath);
            } else if (file.endsWith('.md')) {
                markdownFiles.push(fullPath);
            }
        }
    }

    // Use the configured target directory
    walkDir(TARGET_DIR);

    let changedFiles = 0;
    for (const markdownFilePath of markdownFiles) {
        const markdownContent = fs.readFileSync(markdownFilePath, 'utf8');
        
        // Check if the file starts with a frontmatter opening delimiter
        if (!markdownContent.startsWith('---\n')) {
            console.log(`[SKIPPING] ${markdownFilePath} - No opening frontmatter delimiter`);
            continue;
        }
        
        // Find the frontmatter section
        const frontmatterMatch = markdownContent.match(/^---\n([\s\S]*?)(\n---|\n\s*\n)/);
        if (!frontmatterMatch) {
            console.log(`[SKIPPING] ${markdownFilePath} - Could not parse frontmatter`);
            continue;
        }
        
        // Check if the frontmatter is properly closed with a '---' delimiter
        const hasProperClosing = frontmatterMatch[2].trim() === '---';
        if (hasProperClosing) {
            continue; // Already has proper closing delimiter
        }
        
        // Extract the frontmatter content
        const frontmatterContent = frontmatterMatch[1];
        
        // Find the last non-empty line in the frontmatter
        const lines = frontmatterContent.split('\n');
        let lastNonEmptyLineIndex = lines.length - 1;
        while (lastNonEmptyLineIndex >= 0 && !lines[lastNonEmptyLineIndex].trim()) {
            lastNonEmptyLineIndex--;
        }
        
        // Reconstruct the frontmatter with proper closing delimiter
        const newFrontmatter = lines.slice(0, lastNonEmptyLineIndex + 1).join('\n');
        
        // Reconstruct the document
        const documentContent = markdownContent.substring(frontmatterMatch[0].length);
        const correctedContent = `---\n${newFrontmatter}\n---\n${documentContent}`;
        
        // Write the corrected content back to the file
        fs.writeFileSync(markdownFilePath, correctedContent, 'utf8');
        changedFiles++;
        console.log(`[UPDATED] Added closing frontmatter delimiter to ${markdownFilePath}`);
    }
    
    console.log(`Done. ${changedFiles} files updated.`);
}

main();