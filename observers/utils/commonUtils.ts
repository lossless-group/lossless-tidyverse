/**
 * Common utility functions for the observer system
 * 
 * This module provides shared functionality that can be used across multiple templates
 * and components of the observer system. It implements the "Single Source of Truth" principle
 * to ensure consistent behavior across the system.
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { USER_OPTIONS } from '../userOptionsConfig';
import type { DirectoryConfig } from '../userOptionsConfig';

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

/**
 * Converts a string to Train-Case (first letter of each word capitalized, joined with hyphens)
 *
 * This function is the single source of truth for Train-Case normalization across the observer system.
 * Use for generating canonical slugs, URLs, or normalized tags from arbitrary strings.
 *
 * @param str The string to convert
 * @returns The string in Train-Case
 */
export function convertToTrainCase(str: string): string {
  if (!str) return '';
  // Replace underscores and spaces with hyphens
  let result = str.replace(/[_\s]+/g, '-');
  // Capitalize first letter of each word
  result = result.replace(/(^|\-)([a-z])/g, (match, separator, letter) => {
    return separator + letter.toUpperCase();
  });
  return result;
}

/**
 * Checks if a service/operation is enabled for a given file path, based on USER_OPTIONS in userOptionsConfig.ts
 *
 * @param filePath - The absolute or relative file path being processed
 * @param optionName - The name of the service/operation/feature to check (e.g., 'openGraph', 'addSiteUUID', etc.)
 * @returns true if the option is enabled for the directory, false otherwise
 *
 * This function is the single source of truth for ON/OFF toggling of observer operations.
 * It matches the filePath to the most specific DirectoryConfig (longest path match wins).
 */
export function isEnabledForPath(filePath: string, optionName: keyof DirectoryConfig['services']): boolean {
  // Normalize slashes for cross-platform compatibility
  const normalizedPath = filePath.replace(/\\/g, '/');
  // Find the most specific matching DirectoryConfig (longest path match wins)
  let bestMatch: { path: string; enabled: boolean } | null = null;
  for (const dirConfig of USER_OPTIONS.directories) {
    const dirPath = dirConfig.path.replace(/\\/g, '/');
    if (normalizedPath.includes(dirPath)) {
      const services = dirConfig.services || {};
      const enabled = optionName in services ? Boolean(services[optionName as keyof typeof services]) : false;
      if (!bestMatch || dirPath.length > bestMatch.path.length) {
        bestMatch = { path: dirPath, enabled };
      }
    }
  }
  return bestMatch ? bestMatch.enabled : false;
}
