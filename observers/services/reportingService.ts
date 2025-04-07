/**
 * Reporting Service
 * 
 * Handles writing validation reports to files in the content/reports directory.
 * This ensures that validation results and property conversions are not just logged
 * to the console but also persisted for later review.
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
   * Generate a report for all logged events
   * @returns A string containing the report in markdown format
   */
  generateReport(): string {
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const timeString = today.toTimeString().split(' ')[0];
    
    const report = `---
title: Frontmatter Observer Report
date: ${dateString}
time: ${timeString}
---

## Summary of Files Processed
- Total files processed: ${this.processedFiles.length}
- Files with property name conversions: ${this.getUniqueFilesWithConversions().length}
- Files with validation issues: ${this.validationIssues.length}

### Files with Property Name Conversions
${this.formatConversionList()}

### Files with Validation Issues
${this.formatValidationIssues()}
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
   * Write the report to a file
   */
  async writeReport(): Promise<string> {
    // Ensure the report directory exists
    try {
      await fs.mkdir(this.reportDirectory, { recursive: true });
      console.log(`Ensured report directory exists: ${this.reportDirectory}`);
    } catch (error) {
      console.error(`Error creating report directory: ${error}`);
    }
    
    const report = this.generateReport();
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const timeString = today.toTimeString().split(' ')[0].replace(/:/g, '-');
    
    const filename = `frontmatter-observer-${dateString}-${timeString}.md`;
    const filePath = path.join(this.reportDirectory, filename);
    
    await fs.writeFile(filePath, report, 'utf8');
    console.log(`Report written to ${filePath}`);
    
    // Reset the logs after writing the report
    this.conversionLog = [];
    this.validationIssues = [];
    this.processedFiles = [];
    
    return filePath;
  }
}
