/**
 * YAML Formatter Utility
 * 
 * Provides utilities for formatting YAML frontmatter in a consistent way
 * without adding block scalar syntax or unnecessary quotes.
 * 
 * This is a standalone utility to ensure consistent YAML formatting
 * across the entire observer system.
 */

import { formatDate } from './commonUtils';

/**
 * Formats frontmatter as YAML with consistent formatting
 * NEVER uses block scalar syntax (>- or |-) for any values
 * 
 * @param frontmatter The frontmatter object
 * @returns Formatted YAML frontmatter
 */
export function formatFrontmatter(frontmatter: Record<string, any>): string {
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
      // Use the formatDate utility function from commonUtils
      const formattedDate = formatDate(value);
      yamlContent += `${key}: ${formattedDate}\n`;
    }
    // Handle null values
    else if (value === null) {
      yamlContent += `${key}: null\n`;
    }
    // FORCE SINGLE QUOTES FOR ERROR MESSAGES (project-wide rule)
    else if (
      typeof value === 'string' &&
      (key.endsWith('_error') || key.endsWith('_error_message') || key === 'og_error_message')
    ) {
      // Always wrap error messages in single quotes, escaping inner single quotes
      const singleQuoted = `'${value.replace(/'/g, "''")}'`;
      yamlContent += `${key}: ${singleQuoted}\n`;
    }
    // Handle string values - PRESERVE original formatting
    else if (typeof value === 'string') {
      // Check if this is a URL or contains special characters that need quotes
      if (
        (key.includes('url') || key.includes('image') || key.includes('favicon')) && 
        (value.includes('://') || value.includes(' '))
      ) {
        // Preserve quotes for URLs
        yamlContent += `${key}: "${value}"\n`;
      } 
      // Preserve block scalar syntax if it exists
      else if (value.startsWith('>-') || value.startsWith('|-')) {
        yamlContent += `${key}: ${value}\n`;
      }
      // For all other strings, use the value as-is without adding quotes
      else {
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
 * Extracts frontmatter from markdown content using regex only - no YAML libraries
 * 
 * @param content The markdown content
 * @returns The extracted frontmatter as an object, or null if no frontmatter is found
 */
export function extractFrontmatter(content: string): Record<string, any> | null {
  // Check if content has frontmatter (starts with ---)
  if (!content.startsWith('---')) {
    return null;
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }
  
  // Extract frontmatter content
  const frontmatterContent = content.substring(3, endIndex).trim();
  
  try {
    // Parse frontmatter using regex, not YAML library
    const frontmatter: Record<string, any> = {};
    
    // Split by lines and process each line
    const lines = frontmatterContent.split('\n');
    
    // Track current array property being processed
    let currentArrayProperty: string | null = null;
    let arrayValues: any[] = [];
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Check if this is an array item
      if (line.startsWith('- ') && currentArrayProperty) {
        // Add to current array
        arrayValues.push(line.substring(2).trim());
        continue;
      }
      
      // If we were processing an array and now hit a new property, save the array
      if (currentArrayProperty && !line.startsWith('- ')) {
        frontmatter[currentArrayProperty] = arrayValues;
        currentArrayProperty = null;
        arrayValues = [];
      }
      
      // Check for key-value pair
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Check if this is the start of an array
        if (!value) {
          currentArrayProperty = key;
          arrayValues = [];
          continue;
        }
        
        // Handle different value types
        if (value === 'null' || value === '') {
          frontmatter[key] = null;
        } else if (value === 'true') {
          frontmatter[key] = true;
        } else if (value === 'false') {
          frontmatter[key] = false;
        } else if (!isNaN(Number(value)) && !value.startsWith('0')) {
          // Only convert to number if it doesn't start with 0 (to preserve things like versions)
          frontmatter[key] = value.includes('.') ? parseFloat(value) : parseInt(value);
        } else {
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
          }
          
          frontmatter[key] = value;
        }
      }
    }
    
    // Save the last array if we were processing one
    if (currentArrayProperty && arrayValues.length > 0) {
      frontmatter[currentArrayProperty] = arrayValues;
    }
    
    return frontmatter;
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return null;
  }
}

/**
 * Updates frontmatter in markdown content, preserving existing values
 * 
 * @param content The original markdown content
 * @param updatedFrontmatter The updated frontmatter object
 * @returns The updated markdown content
 */
export function updateFrontmatter(content: string, updatedFrontmatter: Record<string, any>): string {
  // Find the end of the original frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return content;
  }
  
  // Format the frontmatter
  const formattedFrontmatter = formatFrontmatter(updatedFrontmatter);
  
  // Extract the body content after the frontmatter
  let bodyContent = content.substring(endIndex + 3);
  
  // Remove leading whitespace from body content
  bodyContent = bodyContent.replace(/^\s+/, '');
  
  // Create new content with proper frontmatter and exactly two newlines after it
  return `---\n${formattedFrontmatter}---\n\n${bodyContent}`;
}
