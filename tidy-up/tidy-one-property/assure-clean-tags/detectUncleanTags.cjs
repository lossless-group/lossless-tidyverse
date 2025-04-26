const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  // Directory to process (can be overridden via command line args)
  targetDir: process.argv[2] || path.join(__dirname, '../../../../content/changelog--code'),
  
  // Report file location
  reportFile: path.join(__dirname, '../../../../content/reports', `${new Date().toISOString().split('T')[0]}_tag-irregularities-report.md`),
  
  // File patterns to include
  includePatterns: ['**/*.md'],
  
  // Directories to exclude
  excludeDirs: ['node_modules', '.git', 'dist']
};

/**
 * Check if a tag is in Train-Case format
 * @param {string} tag - The tag to check
 * @returns {boolean} True if the tag is in Train-Case
 */
function isTrainCase(tag) {
    // Train-Case: Words-With-Initial-Caps
    return /^[A-Z][a-z0-9]*(?:-[A-Z][a-z0-9]*)*$/.test(tag);
}

/**
 * Check if a line contains tag-related irregularities
 * @param {string} line - The line to check
 * @returns {Object} Object containing irregularity details if found
 */
function checkForTagIrregularities(line) {
    // Skip if not a tag line
    if (!line.trim().startsWith('tags:')) {
        return null;
    }

    const irregularities = [];

    // Check for brackets
    if (line.includes('[') || line.includes(']')) {
        irregularities.push('contains brackets');
    }

    // Check for quotes (single or double)
    if (line.includes("'") || line.includes('"')) {
        irregularities.push('contains quotes');
    }

    // Extract tags for further checks
    const tagContent = line.replace(/^tags:/, '').trim();
    
    // Check for spaces in tags (should be dashes)
    if (tagContent.split(',').some(tag => /\s+/.test(tag.trim()))) {
        irregularities.push('contains spaces in tags');
    }
    
    // Check for Train-Case
    if (tagContent.startsWith('-')) {
        // YAML array format
        const tags = tagContent.split('\n')
            .map(t => t.trim())
            .filter(t => t.startsWith('-'))
            .map(t => t.slice(1).trim());
            
        const nonTrainCaseTags = tags.filter(tag => !isTrainCase(tag));
        if (nonTrainCaseTags.length > 0) {
            irregularities.push(`tags not in Train-Case: ${nonTrainCaseTags.join(', ')}`);
        }
    } else if (tagContent.includes(',')) {
        // Comma-separated format
        const tags = tagContent.split(',').map(t => t.trim().replace(/["']/g, ''));
        const nonTrainCaseTags = tags.filter(tag => !isTrainCase(tag));
        if (nonTrainCaseTags.length > 0) {
            irregularities.push(`tags not in Train-Case: ${nonTrainCaseTags.join(', ')}`);
        }
    } else if (tagContent.startsWith('[')) {
        // Array format
        const tags = tagContent.slice(1, -1).split(',')
            .map(t => t.trim().replace(/["']/g, ''));
        const nonTrainCaseTags = tags.filter(tag => !isTrainCase(tag));
        if (nonTrainCaseTags.length > 0) {
            irregularities.push(`tags not in Train-Case: ${nonTrainCaseTags.join(', ')}`);
        }
    } else {
        // Single tag
        const tag = tagContent.replace(/["']/g, '').trim();
        if (!isTrainCase(tag)) {
            irregularities.push(`tag not in Train-Case: ${tag}`);
        }
    }

    return irregularities.length > 0 ? irregularities : null;
}

/**
 * Process a single markdown file
 * @param {string} filePath - Path to the markdown file
 * @returns {Promise<Object>} Result of processing
 */
async function processMarkdownFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const irregularities = checkForTagIrregularities(line);
        
        if (irregularities) {
            return {
                file: filePath,
                line: line.trim(),
                lineNumber: i + 1,
                issues: irregularities
            };
        }
    }
    
    return null;
}

/**
 * Find all markdown files in a directory
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} List of markdown file paths
 */
async function findMarkdownFiles(dir) {
    const markdownFiles = [];
    const files = await fs.readdir(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory() && !CONFIG.excludeDirs.includes(file)) {
            const nestedFiles = await findMarkdownFiles(fullPath);
            markdownFiles.push(...nestedFiles);
        } else if (file.endsWith('.md')) {
            markdownFiles.push(fullPath);
        }
    }
    return markdownFiles;
}

/**
 * Generate report from results
 * @param {Object} data - Data to include in the report
 * @returns {string} Report content
 */
function generateReport(data) {
    let report = `# Tag Irregularities Report\n\n`;
    report += `Total files: ${data.totalFiles}\n`;
    report += `Files with irregularities: ${data.irregularFiles.length}\n\n`;

    data.irregularFiles.forEach((file) => {
        report += `### ${file.file}\n`;
        report += `* Line ${file.lineNumber}: ${file.line}\n`;
        report += `* Issues: ${file.issues.join(', ')}\n\n`;
    });

    return report;
}

/**
 * Main detection function
 * @param {string} targetDir - Directory to process
 * @returns {Promise<Object>} Detection results
 */
async function detectUncleanTags(targetDir) {
    const files = await findMarkdownFiles(targetDir);
    const results = [];
    
    for (const file of files) {
        const result = await processMarkdownFile(file);
        if (result) results.push(result);
    }

    return {
        totalFiles: files.length,
        irregularFiles: results
    };
}

module.exports = { detectUncleanTags };