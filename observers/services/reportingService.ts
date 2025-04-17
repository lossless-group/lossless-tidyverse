/**
 * Reporting Service
 * 
 * Handles writing validation reports to files in the content/reports directory.
 * This ensures that validation results and property conversions are not just logged
 * to the console but also persisted for later review.
 * 
 * The service also tracks OpenGraph processing statistics for reporting.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ValidationResult } from '../types/template';

/**
 * REPORTING SERVICE USER OPTIONS
 * 
 * Options specific to the reporting service, exported for use by other modules (e.g., fileSystemObserver).
 * - batchReportIntervalMinutes: Number of minutes between automatic batch report generations.
 *   This controls how often the reporting service will attempt to write a batch report if there are unreported changes.
 *   Change this value to set your preferred periodicity for batch reporting.
 */
export const reportingServiceUserOptions = {
  batchReportIntervalMinutes: 5, // Default: 5 minutes. Change as needed.
};

// (Legacy: USER_OPTIONS is deprecated in favor of reportingServiceUserOptions for external use)
/**
 * USER_OPTIONS
 * 
 * User-configurable options for the reporting service.
 * - batchReportIntervalMinutes: Number of minutes between automatic batch report generations.
 *   This controls how often the reporting service will attempt to write a batch report if there are unreported changes.
 *   Change this value to set your preferred periodicity for batch reporting.
 */
export const USER_OPTIONS = {
  batchReportIntervalMinutes: 5, // Default: 5 minutes. Change as needed.
};

/**
 * Service for generating and writing reports
 */
export class ReportingService {
  private reportDirectory: string;
  private conversionLog: Array<{file: string, fromKey: string, toKey: string}> = [];
  private validationIssues: Array<{file: string, result: ValidationResult}> = [];
  private processedFiles: string[] = [];
  private citationConversions: Array<{file: string, count: number}> = [];
  private fieldsAdded: Array<{file: string, field: string, value: any}> = [];
  
  /**
   * OpenGraph processing statistics
   * - processed: Total number of files processed for OpenGraph data
   * - succeeded: Set of files with successful OpenGraph fetches
   * - failed: Set of files with failed OpenGraph fetches
   * - skipped: Set of files skipped (already had data)
   * - screenshotSucceeded: Set of files with successful screenshot URL fetches
   * - screenshotFailed: Set of files with failed screenshot URL fetches
   */
  private openGraphStats = {
    processed: 0,
    succeeded: new Set<string>(),
    failed: new Set<string>(),
    skipped: new Set<string>(),
    screenshotSucceeded: new Set<string>(),
    screenshotFailed: new Set<string>()
  };
  
  /**
   * Tracks the timestamp of the last successfully written report (ms since epoch)
   */
  private lastReportTimestamp: number | null = null;

  /**
   * Tracks whether there have been any changes since the last report was written
   */
  private hasUnreportedChanges: boolean = false;
  
  /**
   * Create a new ReportingService
   * @param baseDir The base directory for the project
   */
  constructor(baseDir: string) {
    // Use absolute path to the reports directory
    this.reportDirectory = '/Users/mpstaton/code/lossless-monorepo/content/reports';
    console.log(`Report directory: ${this.reportDirectory}`);
  }
  
  /**
   * Log a property name conversion
   * @param file The file where the conversion occurred
   * @param fromKey The original property name
   * @param toKey The converted property name
   */
  logConversion(file: string, fromKey: string, toKey: string): void {
    this.conversionLog.push({ file, fromKey, toKey });
    this.hasUnreportedChanges = true;
    console.log(`Converting property name from '${fromKey}' to '${toKey}' in ${file}`);
  }
  
  /**
   * Log a validation result
   * @param file The file that was validated
   * @param result The validation result
   */
  logValidation(file: string, result: ValidationResult): void {
    if (!result.valid) {
      this.validationIssues.push({ file, result });
      this.hasUnreportedChanges = true;
    }
    this.processedFiles.push(file);
    this.hasUnreportedChanges = true;
  }
  
  /**
   * Log OpenGraph processing
   * @param filePath The file path
   * @param status The status of the OpenGraph processing (success, failure, skipped)
   */
  logOpenGraphProcessing(filePath: string, status: 'success' | 'failure' | 'skipped'): void {
    if (status === 'success') {
      this.openGraphStats.succeeded.add(filePath);
      this.hasUnreportedChanges = true;
      console.log(`✅ Successfully fetched OpenGraph data for ${filePath}`);
    } else if (status === 'failure') {
      this.openGraphStats.failed.add(filePath);
      this.hasUnreportedChanges = true;
      console.log(`❌ Failed to fetch OpenGraph data for ${filePath}`);
    } else {
      this.openGraphStats.skipped.add(filePath);
      this.hasUnreportedChanges = true;
      console.log(`⚠️ Skipped OpenGraph fetch for ${filePath} (already has data)`);
    }
    this.openGraphStats.processed++;
    this.hasUnreportedChanges = true;
  }
  
  /**
   * Log screenshot URL processing
   * @param filePath The file path
   * @param status The status of the screenshot URL processing (success, failure)
   */
  logScreenshotProcessing(filePath: string, status: 'success' | 'failure'): void {
    if (status === 'success') {
      this.openGraphStats.screenshotSucceeded.add(filePath);
      this.hasUnreportedChanges = true;
      console.log(`✅ Successfully fetched screenshot URL for ${filePath}`);
    } else {
      this.openGraphStats.screenshotFailed.add(filePath);
      this.hasUnreportedChanges = true;
      console.log(`❌ Failed to fetch screenshot URL for ${filePath}`);
    }
  }
  
  /**
   * Log citation conversion
   * @param filePath The file path
   * @param count The number of citations converted
   */
  logCitationConversion(filePath: string, count: number): void {
    this.citationConversions.push({ file: filePath, count });
    this.hasUnreportedChanges = true;
  }
  
  /**
   * Log a field being added to frontmatter
   * @param file The file where the field was added
   * @param field The name of the field that was added
   * @param value The value that was assigned to the field
   */
  logFieldAdded(file: string, field: string, value: any): void {
    this.fieldsAdded.push({ file, field, value });
    this.hasUnreportedChanges = true;
    console.log(`Added field '${field}' with value '${value}' to ${file}`);
  }
  
  /**
   * Check if any files have been processed
   * @returns True if any files have been processed, false otherwise
   */
  hasProcessedFiles(): boolean {
    return this.processedFiles.length > 0 || this.openGraphStats.processed > 0;
  }
  
  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.conversionLog = [];
    this.validationIssues = [];
    this.processedFiles = [];
    this.citationConversions = [];
    this.fieldsAdded = [];
    this.openGraphStats = {
      processed: 0,
      succeeded: new Set<string>(),
      failed: new Set<string>(),
      skipped: new Set<string>(),
      screenshotSucceeded: new Set<string>(),
      screenshotFailed: new Set<string>()
    };
  }
  
  /**
   * Returns true if a report has ever been written in this session
   */
  hasWrittenReport(): boolean {
    return this.lastReportTimestamp !== null;
  }

  /**
   * Returns true if there are unsaved changes since the last report
   */
  hasUnsavedReportChanges(): boolean {
    return this.hasUnreportedChanges;
  }
  
  /**
   * Format the processed files as a comma-separated cloud of Obsidian backlinks
   * @returns Markdown string for the report
   */
  private formatProcessedFilesBacklinkCloud(): string {
    if (this.processedFiles.length === 0) {
      return 'No files were processed.';
    }
    // Deduplicate, preserve order
    const seen = new Set<string>();
    const backlinks = this.processedFiles
      .filter(file => {
        if (seen.has(file)) return false;
        seen.add(file);
        return true;
      })
      .map(file => this.createBacklink(file));
    return backlinks.join(', ');
  }
  
  /**
   * Generate a report for all logged events
   * @returns A string containing the report in markdown format, or null if no files were processed
   */
  generateReport(): string | null {
    // Skip generating a report if no files were processed
    if (!this.hasProcessedFiles()) {
      return null;
    }
    
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const timeString = today.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    let report = `---
title: Frontmatter Observer Report
date: ${dateString}
time: ${timeString}
---

# Frontmatter Observer Report

## Summary

- **Files Processed**: ${this.processedFiles.length}
- **Property Conversions**: ${this.conversionLog.length}
- **Validation Issues**: ${this.validationIssues.length}
- **Fields Added**: ${this.fieldsAdded.length}
- **Citation Conversions**: ${this.citationConversions.length}
- **OpenGraph Processing**:
  - **Total Processed**: ${this.openGraphStats.processed}
  - **Successfully Fetched**: ${this.openGraphStats.succeeded.size}
  - **Failed to Fetch**: ${this.openGraphStats.failed.size}
  - **Skipped (Already Had Data)**: ${this.openGraphStats.skipped.size}
- **Screenshot URL Processing**:
  - **Successfully Fetched**: ${this.openGraphStats.screenshotSucceeded.size}
  - **Failed to Fetch**: ${this.openGraphStats.screenshotFailed.size}

### Files Processed
${this.formatProcessedFilesBacklinkCloud()}

### Files with Property Name Conversions
${this.formatConversionList()}

### Files with Validation Issues
${this.formatValidationIssues()}

### Files with Fields Added
${this.formatFieldsAdded()}

### Files with Citation Conversions
${this.formatCitationConversions()}

## OpenGraph Processing Details
${this.formatOpenGraphProcessingDetails()}
`;
    
    return report;
  }
  
  /**
   * Helper method to create a properly formatted backlink
   * @param filePath The absolute file path
   * @returns A formatted backlink string [[articles/2025-04-16-example.md|2025-04-16-example.md|2025-04-16 example]]
   */
  private createBacklink(filePath: string): string {
    const basename = path.basename(filePath); // e.g., 2025-04-16-example.md
    const displayName = basename.replace(/\.md$/, '');

    // Human-friendly label: replace hyphens with spaces, remove .md
    const label = displayName.replace(/-/g, ' ');

    // Extract the relative path from the content directory, but EXCLUDE 'content/'
    // Format: /path/to/content/articles/file.md -> articles/file.md
    const relativePath = filePath
      .replace(/^.*?\/content\//, '')  // Remove everything up to and including /content/
      .replace(/^content\//, '')        // Remove 'content/' if it remains
      .replace(/\.md$/, '.md');        // Ensure .md extension is preserved

    return `[[${relativePath}|${displayName}|${label}]]`;
  }
  
  /**
   * Format the conversion log for the report
   * @returns A formatted string
   */
  private formatConversionList(): string {
    if (this.conversionLog.length === 0) {
      return 'No property name conversions were performed.';
    }
    
    // Group by conversion type (fromKey -> toKey)
    const conversionGroups: Record<string, string[]> = {};
    
    for (const conversion of this.conversionLog) {
      const conversionKey = `\`${conversion.fromKey}\` → \`${conversion.toKey}\``;
      
      if (!conversionGroups[conversionKey]) {
        conversionGroups[conversionKey] = [];
      }
      
      // Only add the file if it's not already in the list
      if (!conversionGroups[conversionKey].includes(conversion.file)) {
        conversionGroups[conversionKey].push(conversion.file);
      }
    }
    
    let result = '## Property Name Conversions\n\n';
    
    for (const [conversionKey, files] of Object.entries(conversionGroups)) {
      result += `### ${conversionKey}\n\n`;
      
      // Create comma-separated cloud of backlinks
      const backlinks = files.map(file => this.createBacklink(file));
      
      result += backlinks.join(', ') + '\n\n';
    }
    
    return result;
  }
  
  /**
   * Format the validation issues for the report
   * @returns A formatted string
   */
  private formatValidationIssues(): string {
    if (this.validationIssues.length === 0) {
      return 'No validation issues were found.';
    }
    
    // Group issues by error type
    const errorGroups: Record<string, Array<{ file: string, message: string }>> = {};
    const warningGroups: Record<string, Array<{ file: string, message: string }>> = {};
    
    // Process all validation issues
    for (const issue of this.validationIssues) {
      // Process errors
      for (const error of issue.result.errors) {
        const errorKey = `${error.field}: ${error.message}`;
        
        if (!errorGroups[errorKey]) {
          errorGroups[errorKey] = [];
        }
        
        errorGroups[errorKey].push({
          file: issue.file,
          message: error.message
        });
      }
      
      // Process warnings
      for (const warning of issue.result.warnings) {
        const warningKey = `${warning.field}: ${warning.message}`;
        
        if (!warningGroups[warningKey]) {
          warningGroups[warningKey] = [];
        }
        
        warningGroups[warningKey].push({
          file: issue.file,
          message: warning.message
        });
      }
    }
    
    let result = '';
    
    // Format errors
    if (Object.keys(errorGroups).length > 0) {
      result += '## Validation Errors\n\n';
      
      for (const [errorKey, files] of Object.entries(errorGroups)) {
        result += `### ${errorKey}\n\n`;
        
        // Create comma-separated cloud of backlinks
        const backlinks = files.map(fileInfo => this.createBacklink(fileInfo.file));
        
        result += backlinks.join(', ') + '\n\n';
      }
    }
    
    // Format warnings
    if (Object.keys(warningGroups).length > 0) {
      result += '## Validation Warnings\n\n';
      
      for (const [warningKey, files] of Object.entries(warningGroups)) {
        result += `### ${warningKey}\n\n`;
        
        // Create comma-separated cloud of backlinks
        const backlinks = files.map(fileInfo => this.createBacklink(fileInfo.file));
        
        result += backlinks.join(', ') + '\n\n';
      }
    }
    
    return result;
  }
  
  /**
   * Format the fields added for the report
   * @returns A formatted string
   */
  private formatFieldsAdded(): string {
    if (this.fieldsAdded.length === 0) {
      return 'No fields were added to any files.';
    }
    
    // Group by field added
    const fieldGroups: Record<string, Array<{file: string, value: any}>> = {};
    
    for (const addition of this.fieldsAdded) {
      const fieldKey = `\`${addition.field}\``;
      
      if (!fieldGroups[fieldKey]) {
        fieldGroups[fieldKey] = [];
      }
      
      fieldGroups[fieldKey].push({
        file: addition.file,
        value: addition.value
      });
    }
    
    let result = '## Fields Added to Files\n\n';
    
    for (const [fieldKey, additions] of Object.entries(fieldGroups)) {
      // Group by value for this field
      const valueGroups: Record<string, string[]> = {};
      
      for (const addition of additions) {
        const valueStr = typeof addition.value === 'object' 
          ? JSON.stringify(addition.value) 
          : String(addition.value);
        
        if (!valueGroups[valueStr]) {
          valueGroups[valueStr] = [];
        }
        
        valueGroups[valueStr].push(addition.file);
      }
      
      // For each value of this field
      for (const [valueStr, files] of Object.entries(valueGroups)) {
        result += `### ${fieldKey} added with value: ${valueStr}\n\n`;
        
        // Create comma-separated cloud of backlinks
        const backlinks = files.map(file => this.createBacklink(file));
        
        result += backlinks.join(', ') + '\n\n';
      }
    }
    
    return result;
  }
  
  /**
   * Format the citation conversions for the report
   * @returns A formatted string
   */
  private formatCitationConversions(): string {
    if (this.citationConversions.length === 0) {
      return 'No citation conversions were performed.';
    }
    
    // Group files by citation count
    const citationGroups: Record<number, string[]> = {};
    
    for (const conversion of this.citationConversions) {
      if (!citationGroups[conversion.count]) {
        citationGroups[conversion.count] = [];
      }
      
      citationGroups[conversion.count].push(conversion.file);
    }
    
    let result = '## Files with Citation Conversions\n\n';
    
    // Sort by citation count (descending)
    const sortedCounts = Object.keys(citationGroups)
      .map(count => parseInt(count))
      .sort((a, b) => b - a);
    
    for (const count of sortedCounts) {
      const files = citationGroups[count];
      
      result += `### ${count} Citation${count === 1 ? '' : 's'} Converted\n\n`;
      
      // Create comma-separated cloud of backlinks
      const backlinks = files.map(file => this.createBacklink(file));
      
      result += backlinks.join(', ') + '\n\n';
    }
    
    return result;
  }
  
  /**
   * Format the OpenGraph processing details for the report
   * @returns A formatted string
   */
  private formatOpenGraphProcessingDetails(): string {
    let result = '';
    
    if (this.openGraphStats.succeeded.size > 0) {
      result += '\n### Files with successful OpenGraph fetches\n';
      for (const file of this.openGraphStats.succeeded) {
        result += `- ${this.createBacklink(file)}\n`;
      }
    }
    
    if (this.openGraphStats.failed.size > 0) {
      result += '\n### Files with failed OpenGraph fetches\n';
      for (const file of this.openGraphStats.failed) {
        result += `- ${this.createBacklink(file)}\n`;
      }
    }
    
    if (this.openGraphStats.skipped.size > 0) {
      result += '\n### Files skipped (already had OpenGraph data)\n';
      for (const file of this.openGraphStats.skipped) {
        result += `- ${this.createBacklink(file)}\n`;
      }
    }
    
    if (this.openGraphStats.screenshotSucceeded.size > 0) {
      result += '\n### Files with successful screenshot URL fetches\n';
      for (const file of this.openGraphStats.screenshotSucceeded) {
        result += `- ${this.createBacklink(file)}\n`;
      }
    }
    
    if (this.openGraphStats.screenshotFailed.size > 0) {
      result += '\n### Files with failed screenshot URL fetches\n';
      for (const file of this.openGraphStats.screenshotFailed) {
        result += `- ${this.createBacklink(file)}\n`;
      }
    }
    
    return result;
  }
  
  /**
   * Write the report to a file
   * @returns The path to the report file, or null if no report was generated
   */
  async writeReport(): Promise<string | null> {
    // Generate the report
    const report = this.generateReport();
    // Skip writing if no report was generated
    if (!report) {
      return null;
    }
    // Ensure the report directory exists
    try {
      await fs.mkdir(this.reportDirectory, { recursive: true });
      console.log(`Ensured report directory exists: ${this.reportDirectory}`);
    } catch (error) {
      console.error(`Error creating report directory: ${error}`);
    }
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const timeString = today.toTimeString().split(' ')[0].replace(/:/g, '-');
    const filename = `frontmatter-observer-${dateString}-${timeString}.md`;
    const filePath = path.join(this.reportDirectory, filename);
    await fs.writeFile(filePath, report, 'utf8');
    console.log(`Report written to ${filePath}`);
    // Reset the logs after writing the report
    this.resetStats();
    // --- TRACK REPORT STATE ---
    this.lastReportTimestamp = Date.now();
    this.hasUnreportedChanges = false;
    // --- END TRACK REPORT STATE ---
    return filePath;
  }
}
