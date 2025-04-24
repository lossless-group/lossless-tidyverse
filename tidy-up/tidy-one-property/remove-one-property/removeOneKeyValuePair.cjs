// ================================================
// Script: removeOneKeyValuePair.cjs
// Purpose: Remove ONLY the 'portrait_image:' key (and its value) from YAML frontmatter in all markdown files
//          in /content/lost-in-public/prompts, preserving all other content and formatting.
// ================================================

const fs = require('fs');
const path = require('path');

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

    // Use absolute path to always find the prompts directory
    const PROMPTS_DIR = "/Users/mpstaton/code/lossless-monorepo/content/lost-in-public/prompts";
    walkDir(PROMPTS_DIR);

    // Helper to extract frontmatter block (returns { frontmatterString, startIndex, endIndex, success })
    function extractFrontmatter(markdownContent) {
        const fmRegex = /^---\n([\s\S]*?)\n---/;
        const match = markdownContent.match(fmRegex);
        if (!match) {
            return { success: false };
        }
        const frontmatterString = match[1];
        const startIndex = match.index + 4; // after '---\n'
        const endIndex = match.index + match[0].length;
        return { frontmatterString, startIndex, endIndex, success: true };
    }

    let changedFiles = 0;
    for (const markdownFilePath of markdownFiles) {
        const markdownContent = fs.readFileSync(markdownFilePath, 'utf8');
        const frontmatterData = extractFrontmatter(markdownContent);
        if (!frontmatterData.success) continue;
        let modified = false;
        let newFrontmatter = frontmatterData.frontmatterString;
        const lines = newFrontmatter.split('\n');
        const updatedLines = [];
        for (const line of lines) {
            // Robust match: handles quotes, spaces, indentation, etc.
            const regex = /^([ \t]*["']?)portrait_image(["']?)\s*:/;
            if (regex.test(line)) {
                modified = true;
                // skip this line (remove it)
            } else {
                updatedLines.push(line);
            }
        }
        if (!modified) continue;
        newFrontmatter = updatedLines.join('\n');
        const correctedContent = markdownContent.slice(0, frontmatterData.startIndex) +
            newFrontmatter + markdownContent.slice(frontmatterData.endIndex);
        fs.writeFileSync(markdownFilePath, correctedContent, 'utf8');
        changedFiles++;
        console.log(`[UPDATED] ${markdownFilePath}`);
    }
    console.log(`Done. ${changedFiles} files updated.`);
}

main();