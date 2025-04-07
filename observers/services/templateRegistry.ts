/**
 * Template Registry Service
 * 
 * Manages metadata templates and provides methods to find, validate, and apply templates
 * to markdown files based on their path and content.
 */

import { MetadataTemplate, ValidationResult, ValidationError, ValidationWarning } from '../types/template';
import * as yaml from 'js-yaml';
import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';

// Import templates
import toolingTemplate from '../templates/tooling';

/**
 * Service for managing metadata templates and validating frontmatter
 * 
 * This service is responsible for:
 * 1. Finding the appropriate template for a file
 * 2. Validating frontmatter against templates
 * 3. Generating default frontmatter for new files
 */
export class TemplateRegistry {
  /**
   * Map of template ID to template definition
   * Stores all available templates for lookup
   */
  private templates: Map<string, MetadataTemplate>;
  
  /**
   * Initialize the template registry with available templates
   */
  constructor() {
    this.templates = new Map<string, MetadataTemplate>();
    
    // Register built-in templates
    this.registerTemplate(toolingTemplate);
  }
  
  /**
   * Register a new template with the registry
   * @param template The template to register
   */
  registerTemplate(template: MetadataTemplate): void {
    this.templates.set(template.id, template);
    console.log(`Registered template: ${template.name} (${template.id})`);
  }
  
  /**
   * Find the appropriate template for a file based on its path
   * @param filePath The path to the file
   * @returns The matching template or null if no match is found
   */
  findTemplate(filePath: string): MetadataTemplate | null {
    // Normalize path for matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Find the first template that matches the file path
    for (const template of this.templates.values()) {
      // Check directory patterns
      if (template.appliesTo.directories) {
        for (const pattern of template.appliesTo.directories) {
          if (minimatch(normalizedPath, pattern)) {
            return template;
          }
        }
      }
      
      // Check file patterns
      if (template.appliesTo.filePatterns) {
        for (const pattern of template.appliesTo.filePatterns) {
          if (minimatch(path.basename(normalizedPath), pattern)) {
            return template;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Generate default frontmatter values based on the template
   * @param template The template to use for generating defaults
   * @param filePath The path to the file (used for dynamic defaults)
   * @returns An object with default values for all required fields
   */
  generateDefaults(template: MetadataTemplate, filePath: string): Record<string, any> {
    const defaults: Record<string, any> = {};
    
    // Generate defaults for required fields
    for (const [key, field] of Object.entries(template.required)) {
      if (field.defaultValueFn) {
        defaults[key] = field.defaultValueFn(filePath);
      } else if (field.defaultValue !== undefined) {
        defaults[key] = field.defaultValue;
      } else if (field.type === 'array') {
        defaults[key] = [];
      } else if (field.type === 'boolean') {
        defaults[key] = false;
      } else if (field.type === 'number') {
        defaults[key] = 0;
      } else if (field.type === 'date') {
        const today = new Date();
        defaults[key] = today.toISOString().split('T')[0]; // YYYY-MM-DD
      } else {
        defaults[key] = '';
      }
    }
    
    return defaults;
  }
  
  /**
   * Convert an object to YAML frontmatter
   * @param data The data to convert to YAML
   * @returns A YAML string representation of the data
   */
  async convertToYaml(data: Record<string, any>): Promise<string> {
    return yaml.dump(data, {
      lineWidth: -1, // Don't wrap lines
      noRefs: true,  // Don't use references
      quotingType: '"' // Use double quotes
    });
  }
  
  /**
   * Apply a template to generate frontmatter for a file
   * @param filePath The path to the file
   * @returns A string containing the generated frontmatter or empty string if no template matches
   */
  async applyTemplate(filePath: string): Promise<string> {
    const template = this.findTemplate(filePath);
    if (!template) {
      console.log(`No template found for ${filePath}`);
      return '';
    }
    
    console.log(`Applying template ${template.id} to ${filePath}`);
    const defaults = this.generateDefaults(template, filePath);
    const yaml = await this.convertToYaml(defaults);
    return `---\n${yaml}---\n\n`;
  }
  
  /**
   * Validate frontmatter against a template
   * @param frontmatter The frontmatter to validate
   * @param template The template to validate against
   * @returns A validation result object
   */
  validateAgainstTemplate(frontmatter: Record<string, any>, template: MetadataTemplate | null): ValidationResult {
    if (!template) {
      return {
        valid: true, // No template means no validation requirements
        errors: [],
        warnings: []
      };
    }
    
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestedFixes: Record<string, any> = {};
    
    // Check required fields
    for (const [key, field] of Object.entries(template.required)) {
      // Check if field exists
      if (frontmatter[key] === undefined) {
        errors.push({
          field: key,
          message: `Required field '${key}' is missing`,
          expected: field.type
        });
        
        // Suggest a default value
        if (field.defaultValueFn) {
          suggestedFixes[key] = field.defaultValueFn(frontmatter.filePath || '');
        } else if (field.defaultValue !== undefined) {
          suggestedFixes[key] = field.defaultValue;
        }
        continue;
      }
      
      // Validate field value if validation function exists
      if (field.validation && !field.validation(frontmatter[key])) {
        errors.push({
          field: key,
          message: `Field '${key}' failed validation`,
          value: frontmatter[key],
          expected: field.description
        });
      }
    }
    
    // Check optional fields if they exist
    for (const [key, field] of Object.entries(template.optional)) {
      if (frontmatter[key] !== undefined && field.validation && !field.validation(frontmatter[key])) {
        warnings.push({
          field: key,
          message: `Optional field '${key}' failed validation`,
          value: frontmatter[key],
          suggestion: field.defaultValue
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestedFixes: Object.keys(suggestedFixes).length > 0 ? suggestedFixes : undefined
    };
  }
  
  /**
   * Validate frontmatter for a specific file
   * @param filePath The path to the file
   * @param frontmatter The frontmatter to validate
   * @returns A validation result object
   */
  validate(filePath: string, frontmatter: Record<string, any>): ValidationResult {
    const template = this.findTemplate(filePath);
    return this.validateAgainstTemplate(frontmatter, template);
  }
}
