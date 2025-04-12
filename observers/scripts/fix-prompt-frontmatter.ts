/**
 * Fix Prompt Frontmatter Script
 * 
 * This script finds all prompt files and fixes their frontmatter to:
 * 1. Remove block scalar syntax (>-, |) from any field
 * 2. Fix date formats to use YYYY-MM-DD without timestamps
 * 3. Fix list formatting for authors and tags
 * 4. Ensure proper status values
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml'; // Already used in your project
import { promisify } from 'util';

// Promisify fs functions
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Allowed status values
const ALLOWED_STATUS_VALUES = ['To-Prompt', 'In-Progress', 'Implemented', 'Published'];

/**
 * Recursively find all markdown files in a directory
 * @param dir Directory to search
 * @returns Array of file paths
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  // Read all entries in the directory
  const entries = await readdir(dir);
  
  // Process each entry
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = await stat(fullPath);
    
    if (stats.isDirectory()) {
      // Recursively search subdirectories
      const subFiles = await findMarkdownFiles(fullPath);
      files.push(...subFiles);
    } else if (stats.isFile() && entry.endsWith('.md')) {
      // Add markdown files
      files.push(fullPath);
    }
  }
  
  return files;
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
 * Fix frontmatter for a file
 * @param filePath The path to the file
 */
async function fixFrontmatter(filePath: string): Promise<void> {
  try {
    console.log(`Processing ${filePath}`);
    const content = await readFile(filePath, 'utf8');
    const { frontmatterStr, frontmatter, restContent } = extractFrontmatterAndContent(content);

    if (!frontmatter) {
      console.log(`No frontmatter found in ${filePath}`);
      return;
    }

    // Create a new frontmatter object with fixed values
    const fixedFrontmatter: Record<string, any> = {};

    // Fix string fields (remove block scalar syntax)
    for (const [key, value] of Object.entries(frontmatter)) {
      if (typeof value === 'string') {
        // For date fields, format as YYYY-MM-DD
        if (key.startsWith('date_')) {
          const formattedDate = formatDate(value);
          fixedFrontmatter[key] = formattedDate;
        } else {
          // For other string fields, just use the value directly (no block scalar)
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

    // Fix status field if needed
    if (fixedFrontmatter.status && !ALLOWED_STATUS_VALUES.includes(fixedFrontmatter.status)) {
      console.log(`Invalid status value in ${filePath}: ${fixedFrontmatter.status}`);
      // Default to "To-Prompt" if invalid
      fixedFrontmatter.status = 'To-Prompt';
    }

    // Handle authors field - ensure it's an array
    if (fixedFrontmatter.authors && typeof fixedFrontmatter.authors === 'string') {
      // Convert string to array
      fixedFrontmatter.authors = [fixedFrontmatter.authors];
    }

    // Remove any block scalar syntax from the frontmatter
    // This is done by manually constructing the YAML
    let newFrontmatter = '';
    
    // Add title and lede first
    if (fixedFrontmatter.title) {
      newFrontmatter += `title: ${fixedFrontmatter.title}\n`;
    }
    
    if (fixedFrontmatter.lede) {
      newFrontmatter += `lede: ${fixedFrontmatter.lede}\n`;
    }
    
    // Add date fields
    const dateFields = [
      'date_authored_initial_draft',
      'date_authored_current_draft',
      'date_authored_final_draft',
      'date_first_published',
      'date_last_updated',
      'date_created',
      'date_modified'
    ];
    
    for (const field of dateFields) {
      if (field in fixedFrontmatter) {
        newFrontmatter += `${field}: ${fixedFrontmatter[field]}\n`;
        delete fixedFrontmatter[field];
      }
    }
    
    // Add semantic version
    if (fixedFrontmatter.at_semantic_version) {
      newFrontmatter += `at_semantic_version: ${fixedFrontmatter.at_semantic_version}\n`;
      delete fixedFrontmatter.at_semantic_version;
    }
    
    // Add authors as a list
    if (fixedFrontmatter.authors) {
      newFrontmatter += 'authors:\n';
      for (const author of fixedFrontmatter.authors) {
        newFrontmatter += `- ${author}\n`;
      }
      delete fixedFrontmatter.authors;
    }
    
    // Add status
    if (fixedFrontmatter.status) {
      newFrontmatter += `status: ${fixedFrontmatter.status}\n`;
      delete fixedFrontmatter.status;
    }
    
    // Add augmented_with
    if (fixedFrontmatter.augmented_with) {
      newFrontmatter += `augmented_with: ${fixedFrontmatter.augmented_with}\n`;
      delete fixedFrontmatter.augmented_with;
    }
    
    // Add category
    if (fixedFrontmatter.category) {
      newFrontmatter += `category: ${fixedFrontmatter.category}\n`;
      delete fixedFrontmatter.category;
    }
    
    // Add tags as a list
    if (fixedFrontmatter.tags) {
      newFrontmatter += 'tags:\n';
      for (const tag of fixedFrontmatter.tags) {
        newFrontmatter += `- ${tag}\n`;
      }
      delete fixedFrontmatter.tags;
    }
    
    // Add any remaining fields
    for (const [key, value] of Object.entries(fixedFrontmatter)) {
      if (typeof value === 'string') {
        newFrontmatter += `${key}: ${value}\n`;
      } else if (Array.isArray(value)) {
        newFrontmatter += `${key}:\n`;
        for (const item of value) {
          newFrontmatter += `- ${item}\n`;
        }
      } else if (value === null) {
        newFrontmatter += `${key}: null\n`;
      } else {
        newFrontmatter += `${key}: ${value}\n`;
      }
    }

    // Write the fixed frontmatter back to the file
    const fixedContent = `---\n${newFrontmatter}---\n${restContent}`;
    await writeFile(filePath, fixedContent);
    console.log(`Fixed frontmatter in ${filePath}`);
  } catch (error) {
    console.error(`Error fixing frontmatter in ${filePath}:`, error);
  }
}

/**
 * Main function to find and fix all prompt files
 */
async function main() {
  try {
    console.log('Finding prompt files...');
    const promptsDir = '/Users/mpstaton/code/lossless-monorepo/content/lost-in-public/prompts';
    const promptFiles = await findMarkdownFiles(promptsDir);
    console.log(`Found ${promptFiles.length} prompt files`);

    for (const filePath of promptFiles) {
      await fixFrontmatter(filePath);
    }

    console.log('Done fixing frontmatter in all prompt files');
  } catch (error) {
    console.error('Error finding prompt files:', error);
  }
}

// Run the script
main();
