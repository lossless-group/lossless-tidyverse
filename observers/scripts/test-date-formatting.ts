/**
 * Test script for date formatting in frontmatter
 * 
 * This script tests the date formatting functionality on a single file
 * to ensure it correctly handles all date formats.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { promisify } from 'util';

// Import our utility functions
import { getFileCreationDate, getCurrentDate } from '../utils/commonUtils';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

/**
 * Format a date to YYYY-MM-DD
 * @param dateValue The date value to format
 * @returns The formatted date
 */
function formatDate(dateValue: any): string | null {
  if (!dateValue || dateValue === 'null') {
    return null;
  }

  try {
    // If it's already in YYYY-MM-DD format, return it
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }

    // Handle ISO string format with time component
    if (typeof dateValue === 'string' && dateValue.includes('T')) {
      // Just extract the date part
      return dateValue.split('T')[0];
    }

    // Try to parse the date
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return null;
    }

    // Format as YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('Error formatting date:', error);
    return null;
  }
}

/**
 * Format frontmatter as YAML with proper formatting
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
      if (/[:#\[\]{}|>*&!%@,]/.test(value) || value.includes('\n')) {
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
 * Extract frontmatter and content from a markdown file
 * @param content The file content
 * @returns The frontmatter as a string, the parsed frontmatter object, and the rest of the content
 */
function extractFrontmatterAndContent(content: string): { 
  frontmatterStr: string | null; 
  frontmatter: Record<string, any> | null; 
  restContent: string 
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatterStr: null, frontmatter: null, restContent: content };
  }

  try {
    const frontmatterStr = match[1];
    const restContent = match[2];
    const frontmatter = yaml.load(frontmatterStr) as Record<string, any>;
    return { frontmatterStr, frontmatter, restContent };
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return { frontmatterStr: null, frontmatter: null, restContent: content };
  }
}

/**
 * Fix frontmatter for a file
 * @param filePath The path to the file
 */
async function fixFrontmatter(filePath: string): Promise<void> {
  try {
    console.log(`Processing ${filePath}`);
    const content = await readFile(filePath, 'utf8');
    const { frontmatter, restContent } = extractFrontmatterAndContent(content);

    if (!frontmatter) {
      console.log(`No frontmatter found in ${filePath}`);
      return;
    }

    // Create a new frontmatter object with fixed values
    const fixedFrontmatter: Record<string, any> = {};

    // Fix all fields
    for (const [key, value] of Object.entries(frontmatter)) {
      if (typeof value === 'string') {
        // For date fields, format as YYYY-MM-DD
        if (key.startsWith('date_')) {
          const formattedDate = formatDate(value);
          fixedFrontmatter[key] = formattedDate;
          console.log(`  Fixed date field ${key}: ${value} -> ${formattedDate}`);
        } else {
          // For other string fields, just use the value directly
          fixedFrontmatter[key] = value;
        }
      } else if (Array.isArray(value)) {
        // Keep arrays as is
        fixedFrontmatter[key] = value;
      } else {
        // Keep other values as is
        fixedFrontmatter[key] = value;
      }
    }

    // Format the frontmatter as YAML
    const yamlContent = formatFrontmatter(fixedFrontmatter);

    // Write the fixed frontmatter back to the file
    const fixedContent = `---\n${yamlContent}---\n${restContent}`;
    await writeFile(filePath, fixedContent);
    console.log(`Fixed frontmatter in ${filePath}`);
  } catch (error) {
    console.error(`Error fixing frontmatter in ${filePath}:`, error);
  }
}

/**
 * Main function to test date formatting on a single file
 */
async function main() {
  try {
    // Test on a single file
    const testFile = '/Users/mpstaton/code/lossless-monorepo/content/vocabulary/Collaboration Cost.md';
    await fixFrontmatter(testFile);
    console.log('Done fixing frontmatter');
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the script
main();
