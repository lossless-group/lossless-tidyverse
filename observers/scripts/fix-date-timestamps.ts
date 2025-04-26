/**
 * Fix Date Timestamps in Frontmatter
 * 
 * One-off script to fix date fields in frontmatter that contain timestamps.
 * This script will:
 * 1. Find all markdown files in the specified directory
 * 2. Extract frontmatter from each file
 * 3. Check for date fields with timestamps
 * 4. Convert them to YYYY-MM-DD format using the formatDate utility
 * 5. Write the updated frontmatter back to the file
 * 
 * Usage:
 *   npx ts-node fix-date-timestamps.ts <directory-path>
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { formatDate } from '../utils/commonUtils';

/**
 * Formats frontmatter as YAML with proper formatting
 * 
 * @param frontmatter The frontmatter object
 * @returns Formatted YAML frontmatter
 */
function formatFrontmatter(frontmatter: Record<string, any>): string {
  // Create a copy of the frontmatter to avoid modifying the original
  const formattedFrontmatter = { ...frontmatter };
  
  // Arrays that should be formatted with list syntax (with hyphens)
  const arrayFields = ['tags', 'authors', 'aliases'];
  
  // Extract all array fields that need special formatting
  const extractedArrays: Record<string, any[]> = {};
  
  for (const field of arrayFields) {
    if (formattedFrontmatter[field] && Array.isArray(formattedFrontmatter[field])) {
      extractedArrays[field] = formattedFrontmatter[field];
      delete formattedFrontmatter[field];
    }
  }
  
  // Manually construct the YAML to ensure proper formatting
  let yamlContent = '';
  
  // Process each field in the frontmatter
  for (const [key, value] of Object.entries(formattedFrontmatter)) {
    // Skip array fields (they're handled separately)
    if (arrayFields.includes(key)) continue;
    
    // Handle date fields specially to avoid quotes and timestamps
    if (key.startsWith('date_') && value) {
      // Format the date properly - ensure no quotes
      const formattedDate = formatDate(value);
      yamlContent += `${key}: ${formattedDate}\n`;
    }
    // Handle null values
    else if (value === null) {
      yamlContent += `${key}: null\n`;
    }
    // Handle string values
    else if (typeof value === 'string') {
      // If the string contains special characters, quote it
      // But never quote date fields
      if (!key.startsWith('date_') && (/[:#\[\]{}|>*&!%@,]/.test(value) || value.includes('\n'))) {
        yamlContent += `${key}: "${value.replace(/"/g, '\\"')}"\n`;
      } else {
        yamlContent += `${key}: ${value}\n`;
      }
    }
    // Handle other values
    else {
      yamlContent += `${key}: ${value}\n`;
    }
  }
  
  // Append each array field in the correct format
  for (const [field, values] of Object.entries(extractedArrays)) {
    yamlContent += `${field}:\n`;
    for (const value of values) {
      yamlContent += `  - ${value}\n`;
    }
  }
  
  return yamlContent;
}

/**
 * Process a single markdown file to fix date timestamps
 * 
 * @param filePath Path to the markdown file
 * @returns Object with information about the processing
 */
async function processFile(filePath: string): Promise<{
  filePath: string;
  fixed: boolean;
  dateFields: string[];
}> {
  // Read the file content
  const content = await fs.readFile(filePath, 'utf8');
  
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    return { filePath, fixed: false, dateFields: [] };
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { filePath, fixed: false, dateFields: [] };
  }
  
  // Extract frontmatter content
  const frontmatterContent = content.substring(3, endIndex).trim();
  
  try {
    // Parse YAML frontmatter
    const frontmatter = yaml.load(frontmatterContent) as Record<string, any>;
    
    // Track if any date fields were fixed
    let fixed = false;
    const dateFields: string[] = [];
    
    // Check for date fields with timestamps or quotes
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key.startsWith('date_') && typeof value === 'string') {
        let needsFixing = false;
        let reason = '';
        
        // Check if the date has a timestamp
        if (value.includes('T') || /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
          needsFixing = true;
          reason = 'timestamp';
        }
        
        // Check if the date is quoted (starts and ends with quotes)
        // This checks for both single and double quotes
        if ((typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) || 
            (typeof value === 'string' && value.startsWith('"') && value.endsWith('"'))) {
          needsFixing = true;
          reason = reason ? 'timestamp and quotes' : 'quotes';
        }
        
        // Direct check for the raw YAML content to find quoted dates
        // This is needed because js-yaml automatically unquotes values when parsing
        const datePattern = new RegExp(`${key}:\\s*['"]([^'"]+)['"]`);
        const match = frontmatterContent.match(datePattern);
        if (match) {
          needsFixing = true;
          reason = reason ? `${reason} (found in raw YAML)` : 'quotes (found in raw YAML)';
        }
        
        if (needsFixing) {
          console.log(`Found date with ${reason} in ${filePath}: ${key}=${value}`);
          
          // Format the date properly and remove quotes
          let formattedDate = formatDate(value);
          
          // Remove quotes if they exist
          if (typeof formattedDate === 'string') {
            formattedDate = formattedDate.replace(/^['"]|['"]$/g, '');
          }
          
          frontmatter[key] = formattedDate;
          
          dateFields.push(key);
          fixed = true;
        }
      }
    }
    
    // If any date fields were fixed, update the file
    if (fixed) {
      // Format the frontmatter with proper formatting
      const formattedFrontmatter = formatFrontmatter(frontmatter);
      
      // Replace the original frontmatter with the formatted one
      let bodyContent = content.substring(endIndex + 3);
      
      // Extract the actual content, ignoring all blank lines at the beginning
      const actualContent = bodyContent.replace(/^\s+/, '').trim();
      
      // Create new content with proper frontmatter and exactly two newlines after it
      const newContent = `---\n${formattedFrontmatter}---\n\n${actualContent}`;
      await fs.writeFile(filePath, newContent, 'utf8');
      
      console.log(`Fixed date formatting in ${filePath}`);
    }
    
    return { filePath, fixed, dateFields };
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return { filePath, fixed: false, dateFields: [] };
  }
}

/**
 * Recursively find all markdown files in a directory
 * 
 * @param directory The directory to search
 * @returns Array of file paths
 */
async function findMarkdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  
  // Read the directory contents
  const entries = await fs.readdir(directory, { withFileTypes: true });
  
  // Process each entry
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    
    if (entry.isDirectory()) {
      // Recursively search subdirectories
      const subDirFiles = await findMarkdownFiles(fullPath);
      result.push(...subDirFiles);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Add markdown files to the result
      result.push(fullPath);
    }
  }
  
  return result;
}

/**
 * Main function to find and process all markdown files
 */
async function main() {
  // Get the directory to process from command line arguments
  const directoryToProcess = process.argv[2];
  
  if (!directoryToProcess) {
    console.error('Please provide a directory path as an argument');
    process.exit(1);
  }
  
  const resolvedPath = path.resolve(directoryToProcess);
  
  console.log(`Starting date timestamp fix script for directory: ${resolvedPath}`);
  
  try {
    // Check if the directory exists
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      console.error(`${resolvedPath} is not a directory`);
      process.exit(1);
    }
    
    // Find all markdown files in the directory
    const files = await findMarkdownFiles(resolvedPath);
    
    console.log(`Found ${files.length} markdown files in ${resolvedPath}`);
    
    // Track statistics
    let totalFiles = 0;
    let fixedFiles = 0;
    const fixedDateFields: Record<string, number> = {};
    
    // Process each file
    for (const file of files) {
      totalFiles++;
      
      const result = await processFile(file);
      
      if (result.fixed) {
        fixedFiles++;
        
        // Track which date fields were fixed
        for (const field of result.dateFields) {
          fixedDateFields[field] = (fixedDateFields[field] || 0) + 1;
        }
      }
    }
    
    // Print summary
    console.log('\n=== Summary ===');
    console.log(`Total files processed: ${totalFiles}`);
    console.log(`Files with fixed date timestamps: ${fixedFiles}`);
    console.log('Fixed date fields:');
    for (const [field, count] of Object.entries(fixedDateFields)) {
      console.log(`  - ${field}: ${count} times`);
    }
  } catch (error) {
    console.error(`Error processing directory ${resolvedPath}:`, error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Error running date timestamp fix script:', error);
  process.exit(1);
});
