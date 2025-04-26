const fs = require('fs').promises;
const path = require('path');
const { knownUncleanCases, tagsMayHaveInconsistentSyntax } = require('./casesUncleanTags.cjs');

/**
 * Convert a tag to Train-Case
 * @param {string} tag - Tag to convert
 * @returns {string} Train-Case tag
 */
function toTrainCase(tag) {
    // Remove any quotes and extra spaces
    tag = tag.replace(/["']/g, '').trim();
    
    // If already in Train-Case, return as is
    if (/^[A-Z][a-z0-9]*(?:-[A-Z][a-z0-9]*)*$/.test(tag)) {
        return tag;
    }
    
    // Split on dashes or spaces
    const words = tag.split(/[-\s]+/);
    
    // Capitalize first letter of each word
    return words.map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join('-');
}

/**
 * Clean tags in a single file
 * @param {string} filePath - Path to the file to clean
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} Result of cleaning
 */
async function cleanTagsInFile(filePath, config) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        let modified = false;
        let inFrontmatter = false;
        let tagStart = -1;
        let tagEnd = -1;
        let tagLines = [];
        
        // First pass: collect tag lines
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Track frontmatter
            if (line.trim() === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
            }
            
            if (inFrontmatter) {
                if (line.trim().startsWith('tags:')) {
                    tagStart = i;
                    tagLines = [line];
                } else if (tagStart !== -1 && line.trim().startsWith('-')) {
                    tagLines.push(line);
                    tagEnd = i;
                } else if (tagStart !== -1 && tagEnd === -1) {
                    // Single line tags
                    tagEnd = tagStart;
                }
            }
        }
        
        // Process tags if found
        if (tagStart !== -1) {
            const originalTags = tagLines.join('\n');
            const cleanedTags = cleanTagLine(originalTags);
            
            if (cleanedTags !== originalTags) {
                modified = true;
                
                // Create backup if needed
                if (config.createBackups) {
                    const backupPath = filePath + '.bak';
                    await fs.writeFile(backupPath, content);
                }
                
                // Replace tag section
                const cleanedLines = cleanedTags.split('\n');
                lines.splice(tagStart, (tagEnd - tagStart + 1), ...cleanedLines);
                
                // Write cleaned content
                await fs.writeFile(filePath, lines.join('\n'));
            }
        }
        
        return {
            file: filePath,
            modified,
            backupCreated: modified && config.createBackups
        };
    } catch (error) {
        console.error('Error cleaning tags in file:', filePath, error);
        return {
            file: filePath,
            modified: false,
            error: error.message
        };
    }
}

/**
 * Clean a single tag line
 * @param {string} line - Line containing tags
 * @returns {string} Cleaned line
 */
function cleanTagLine(line) {
    // Extract just the tags part
    let tags = [];
    const lines = line.split('\n');
    
    // Process each line
    for (const l of lines) {
        const trimmed = l.trim();
        if (trimmed.startsWith('tags:')) {
            const rest = trimmed.slice(5).trim();
            if (rest) {
                if (rest.startsWith('[') && rest.endsWith(']')) {
                    // Handle array format
                    tags = rest.slice(1, -1).split(',')
                        .map(t => t.trim().replace(/["']/g, ''))
                        .filter(t => t.length > 0);
                } else if (rest.includes(',')) {
                    // Handle comma format
                    tags = rest.split(',')
                        .map(t => t.trim().replace(/["']/g, ''))
                        .filter(t => t.length > 0);
                } else {
                    // Single tag
                    tags = [rest.replace(/["']/g, '').trim()].filter(t => t.length > 0);
                }
            }
        } else if (trimmed.startsWith('-')) {
            // Handle list item
            const tag = trimmed.slice(1).trim();
            if (tag.length > 0) {
                tags.push(tag);
            }
        }
    }
    
    // Convert all tags to Train-Case
    tags = tags
        .filter(tag => tag.length > 0)
        .map(tag => toTrainCase(tag));
    
    // Return formatted tags
    if (tags.length === 0) {
        return 'tags:';
    }
    
    return 'tags:\n' + tags.map(tag => `  - ${tag}`).join('\n');
}

/**
 * Clean tags in multiple files
 * @param {string[]} filePaths - Paths to files to clean
 * @param {Object} config - Configuration options
 * @returns {Promise<Object[]>} Results of cleaning
 */
async function cleanAllTags(filePaths, config) {
    const results = [];
    
    for (const filePath of filePaths) {
        try {
            const result = await cleanTagsInFile(filePath, config);
            results.push(result);
        } catch (error) {
            console.error('Error cleaning tags in file:', filePath, error);
            results.push({
                file: filePath,
                modified: false,
                error: error.message
            });
        }
    }
    
    return results;
}

module.exports = { cleanAllTags };