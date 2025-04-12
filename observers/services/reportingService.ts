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
    }
    this.processedFiles.push(file);
  }
  
  /**
   * Log OpenGraph processing
   * @param filePath The file path
   * @param status The status of the OpenGraph processing (success, failure, skipped)
   */
  logOpenGraphProcessing(filePath: string, status: 'success' | 'failure' | 'skipped'): void {
    if (status === 'success') {
      this.openGraphStats.succeeded.add(filePath);
      console.log(`✅ Successfully fetched OpenGraph data for ${filePath}`);
    } else if (status === 'failure') {
      this.openGraphStats.failed.add(filePath);
      console.log(`❌ Failed to fetch OpenGraph data for ${filePath}`);
    } else {
      this.openGraphStats.skipped.add(filePath);
      console.log(`⚠️ Skipped OpenGraph fetch for ${filePath} (already has data)`);
    }
    this.openGraphStats.processed++;
  }
  
  /**
   * Log screenshot URL processing
   * @param filePath The file path
   * @param status The status of the screenshot URL processing (success, failure)
   */
  logScreenshotProcessing(filePath: string, status: 'success' | 'failure'): void {
    if (status === 'success') {
      this.openGraphStats.screenshotSucceeded.add(filePath);
      console.log(`✅ Successfully fetched screenshot URL for ${filePath}`);
    } else {
      this.openGraphStats.screenshotFailed.add(filePath);
      console.log(`❌ Failed to fetch screenshot URL for ${filePath}`);
    }
  }
  
  /**
   * Log citation conversion
   * @param filePath The file path
   * @param count The number of citations converted
   */
  logCitationConversion(filePath: string, count: number): void {
    if (count > 0) {
      console.log(`📝 Converted ${count} citations in ${filePath}`);
      // Add to processed files if not already there
      if (!this.processedFiles.includes(filePath)) {
        this.processedFiles.push(filePath);
      }
      this.citationConversions.push({ file: filePath, count });
    }
  }
  
  /**
   * Log a field being added to frontmatter
   * @param file The file where the field was added
   * @param field The name of the field that was added
   * @param value The value that was assigned to the field
   */
  logFieldAdded(file: string, field: string, value: any): void {
    this.fieldsAdded.push({ file, field, value });
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
   * Get a list of unique files that had property name conversions
   * @returns An array of file paths
   */
  private getUniqueFilesWithConversions(): string[] {
    const uniqueFiles = new Set<string>();
    for (const conversion of this.conversionLog) {
      uniqueFiles.add(conversion.file);
    }
    return Array.from(uniqueFiles);
  }
  
  /**
   * Format the conversion log for the report
   * @returns A formatted string
   */
  private formatConversionList(): string {
    if (this.conversionLog.length === 0) {
      return 'No property name conversions were performed.';
    }
    
    const uniqueFiles = this.getUniqueFilesWithConversions();
    let result = '';
    
    for (const file of uniqueFiles) {
      const conversionsForFile = this.conversionLog.filter(c => c.file === file);
      const basename = path.basename(file);
      
      result += `#### [[${basename}]]\n`;
      for (const conversion of conversionsForFile) {
        result += `- \`${conversion.fromKey}\` → \`${conversion.toKey}\`\n`;
      }
      result += '\n';
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
    
    let result = '';
    
    for (const issue of this.validationIssues) {
      const basename = path.basename(issue.file);
      
      result += `#### [[${basename}]]\n`;
      
      if (issue.result.errors.length > 0) {
        result += '**Errors:**\n';
        for (const error of issue.result.errors) {
          result += `- ${error.field}: ${error.message}\n`;
        }
      }
      
      if (issue.result.warnings.length > 0) {
        result += '**Warnings:**\n';
        for (const warning of issue.result.warnings) {
          result += `- ${warning.field}: ${warning.message}\n`;
        }
      }
      
      if (issue.result.suggestedFixes) {
        result += '**Suggested Fixes:**\n';
        for (const [key, value] of Object.entries(issue.result.suggestedFixes)) {
          result += `- ${key}: ${JSON.stringify(value)}\n`;
        }
      }
      
      result += '\n';
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
    
    const uniqueFiles = new Set<string>();
    for (const addition of this.fieldsAdded) {
      uniqueFiles.add(addition.file);
    }
    
    let result = '';
    
    for (const file of uniqueFiles) {
      const additionsForFile = this.fieldsAdded.filter(a => a.file === file);
      const basename = path.basename(file);
      
      result += `#### [[${basename}]]\n`;
      for (const addition of additionsForFile) {
        const valueStr = typeof addition.value === 'object' 
          ? JSON.stringify(addition.value) 
          : String(addition.value);
        result += `- Added \`${addition.field}\`: ${valueStr}\n`;
      }
      result += '\n';
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
    
    let result = '';
    
    for (const conversion of this.citationConversions) {
      const basename = path.basename(conversion.file);
      
      result += `#### [[${basename}]]\n`;
      result += `- Converted ${conversion.count} citations\n`;
      result += '\n';
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
        const relativePath = file.replace(/^.*\/content\//, 'content/');
        result += `- [[${relativePath}]]\n`;
      }
    }
    
    if (this.openGraphStats.failed.size > 0) {
      result += '\n### Files with failed OpenGraph fetches\n';
      for (const file of this.openGraphStats.failed) {
        const relativePath = file.replace(/^.*\/content\//, 'content/');
        result += `- [[${relativePath}]]\n`;
      }
    }
    
    if (this.openGraphStats.skipped.size > 0) {
      result += '\n### Files skipped (already had OpenGraph data)\n';
      for (const file of this.openGraphStats.skipped) {
        const relativePath = file.replace(/^.*\/content\//, 'content/');
        result += `- [[${relativePath}]]\n`;
      }
    }
    
    if (this.openGraphStats.screenshotSucceeded.size > 0) {
      result += '\n### Files with successful screenshot URL fetches\n';
      for (const file of this.openGraphStats.screenshotSucceeded) {
        const relativePath = file.replace(/^.*\/content\//, 'content/');
        result += `- [[${relativePath}]]\n`;
      }
    }
    
    if (this.openGraphStats.screenshotFailed.size > 0) {
      result += '\n### Files with failed screenshot URL fetches\n';
      for (const file of this.openGraphStats.screenshotFailed) {
        const relativePath = file.replace(/^.*\/content\//, 'content/');
        result += `- [[${relativePath}]]\n`;
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
    
    return filePath;
  }
}
