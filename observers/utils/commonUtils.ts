/**
 * Common utility functions for the observer system
 * 
 * This module provides shared functionality that can be used across multiple templates
 * and components of the observer system. It implements the "Single Source of Truth" principle
 * to ensure consistent behavior across the system.
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

/**
 * Generate a UUID v4 for use in frontmatter
 * 
 * This function is the single source of truth for UUID generation across all templates.
 * Any template that needs to generate a UUID should use this function rather than
 * implementing its own UUID generation logic.
 * 
 * @returns A new UUID v4 string
 */
export function generateUUID(): string {
  // Generate a new UUID v4
  return uuidv4();
}

/**
 * Format a date value to YYYY-MM-DD format
 * 
 * This function is the single source of truth for formatting dates across all templates.
 * It handles various date formats and ensures they are converted to YYYY-MM-DD.
 * 
 * @param dateValue - The date value to format (string, Date object, or timestamp)
 * @returns The date in YYYY-MM-DD format, or null if the input is invalid
 */
export function formatDate(dateValue: any): string | null {
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
    console.error(`Error formatting date:`, error);
    return null;
  }
}

/**
 * Get the creation date of a file
 * 
 * This function is the single source of truth for retrieving file creation dates.
 * It handles error cases and ensures consistent behavior across all templates.
 * 
 * @param filePath - The path to the file
 * @returns The creation date in YYYY-MM-DD format, or null if the file doesn't exist or there's an error
 */
export function getFileCreationDate(filePath: string): string | null {
  try {
    console.log(`Getting creation date for ${filePath}`);
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
      // Get file stats to access creation time
      const stats = fs.statSync(filePath);
      
      // Use birthtime (actual file creation time) which is reliable on Mac
      const timestamp = stats.birthtime;
      
      // Use the formatDate function to ensure consistent formatting
      const formattedDate = formatDate(timestamp);
      
      console.log(`File creation date for ${filePath}: ${formattedDate}`);
      
      // Return only YYYY-MM-DD format without quotes
      return formattedDate;
    } else {
      console.log(`File does not exist: ${filePath}`);
      // Return null instead of current date
      return null;
    }
  } catch (error) {
    console.error(`Error getting file stats for ${filePath}:`, error);
    // Return null instead of current date
    return null;
  }
}

/**
 * Get the current date
 * 
 * This function is the single source of truth for retrieving the current date.
 * 
 * @returns The current date in YYYY-MM-DD format without quotes
 */
export function getCurrentDate(): string {
  // Use the formatDate function to ensure consistent formatting
  return formatDate(new Date()) as string;
}
