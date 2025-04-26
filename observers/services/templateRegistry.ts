/**
 * Template Registry Service
 * 
 * Manages templates for different content types and provides validation.
 */

import { MetadataTemplate, ValidationResult, ValidationError, ValidationWarning } from '../types/template';
import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';
// Fix imports to use default exports
import promptsTemplate from '../templates/prompts';
import vocabularyTemplate from '../templates/vocabulary';
import toolingTemplate from '../templates/tooling';
import specificationsTemplate from '../templates/specifications';
import { formatFrontmatter } from '../utils/yamlFrontmatter';

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
    this.registerTemplate(vocabularyTemplate);
    this.registerTemplate(promptsTemplate);
    this.registerTemplate(specificationsTemplate);
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
    
    console.log(`Finding template for: ${normalizedPath}`);
    
    // Find the first template that matches the file path
    for (const template of this.templates.values()) {
      // Check directory patterns
      if (template.appliesTo.directories) {
        for (const pattern of template.appliesTo.directories) {
          // For absolute paths, check if they contain the pattern
          // For example, if pattern is 'content/tooling/**/*' and path is '/Users/name/project/content/tooling/file.md'
          if (template.id === 'tooling' && normalizedPath.includes('content/tooling/')) {
            console.log(`Template ${template.id} matches path ${normalizedPath}`);
            return template;
          }
          
          // Check for vocabulary template
          if (template.id === 'vocabulary' && normalizedPath.includes('content/vocabulary/')) {
            console.log(`Template ${template.id} matches path ${normalizedPath}`);
            return template;
          }
          
          // Check for prompts template
          if (template.id === 'prompts' && normalizedPath.includes('content/lost-in-public/prompts/')) {
            console.log(`Template ${template.id} matches path ${normalizedPath}`);
            return template;
          }
          
          // Check for specifications template
          if (template.id === 'specifications' && normalizedPath.includes('content/specs/')) {
            console.log(`Template ${template.id} matches path ${normalizedPath}`);
            return template;
          }
          
          // Also try the direct minimatch for relative paths
          if (minimatch(normalizedPath, pattern)) {
            console.log(`Template ${template.id} matches path ${normalizedPath} with pattern ${pattern}`);
            return template;
          }
        }
      }
      
      // Check file patterns
      if (template.appliesTo.filePatterns) {
        for (const pattern of template.appliesTo.filePatterns) {
          if (minimatch(path.basename(normalizedPath), pattern)) {
            console.log(`Template ${template.id} matches filename ${path.basename(normalizedPath)} with pattern ${pattern}`);
            return template;
          }
        }
      }
    }
    
    console.log(`No template found for ${normalizedPath}`);
    return null;
  }
  
  /**
   * Find all templates that apply to a specific file
   * This is different from findTemplate as it returns all matching templates,
   * which is useful for content processing templates that might apply to the same file
   * @param filePath The path to the file
   * @returns Array of matching templates
   */
  findTemplateForFile(filePath: string): MetadataTemplate[] {
    // Normalize path for matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    console.log(`Finding content processing template for: ${normalizedPath}`);
    
    // Find templates that have content processing enabled
    const matchingTemplates: MetadataTemplate[] = [];
    for (const template of this.templates.values()) {
      // Skip templates without content processing
      if (!template.contentProcessing || !template.contentProcessing.enabled) {
        continue;
      }
      
      // Check directory patterns
      if (template.appliesTo.directories) {
        for (const pattern of template.appliesTo.directories) {
          // For absolute paths, check if they contain the pattern
          if (normalizedPath.includes(pattern.replace('**/*', ''))) {
            console.log(`Content processing template ${template.id} matches path ${normalizedPath}`);
            matchingTemplates.push(template);
          }
          
          // Also try the direct minimatch for relative paths
          if (minimatch(normalizedPath, pattern)) {
            console.log(`Content processing template ${template.id} matches path ${normalizedPath} with pattern ${pattern}`);
            matchingTemplates.push(template);
          }
        }
      }
      
      // Check file patterns
      if (template.appliesTo.filePatterns) {
        for (const pattern of template.appliesTo.filePatterns) {
          if (minimatch(path.basename(normalizedPath), pattern)) {
            console.log(`Content processing template ${template.id} matches filename ${path.basename(normalizedPath)} with pattern ${pattern}`);
            matchingTemplates.push(template);
          }
        }
      }
    }
    
    console.log(`Found ${matchingTemplates.length} content processing templates for ${normalizedPath}`);
    return matchingTemplates;
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
   * Convert data to YAML format without using YAML libraries
   * @param data The data to convert
   * @returns A YAML string representation of the data
   */
  async convertToYaml(data: Record<string, any>): Promise<string> {
    // Use the formatFrontmatter function which manually constructs YAML
    // This ensures consistent formatting without relying on YAML libraries
    return formatFrontmatter(data);
  }
  
  /**
   * Apply a template to a file
   * @param filePath The path to the file
   * @returns The template content
   */
  async applyTemplate(filePath: string): Promise<string> {
    const template = this.findTemplate(filePath);
    if (!template) {
      console.log(`No template found for ${filePath}`);
      return '';
    }
    
    console.log(`Applying template ${template.id} to ${filePath}`);
    const defaults = this.generateDefaults(template, filePath);
    const yaml = formatFrontmatter(defaults);
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
    
    // Convert any kebab-case property names to snake_case
    frontmatter = this.convertPropertyNamesToSnakeCase(frontmatter);
    
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
    // Convert any kebab-case property names to snake_case before validation
    frontmatter = this.convertPropertyNamesToSnakeCase(frontmatter);
    
    const template = this.findTemplate(filePath);
    return this.validateAgainstTemplate(frontmatter, template);
  }
  
  /**
   * Convert kebab-case property names to snake_case
   * @param frontmatter The frontmatter object to process
   * @returns A new object with converted property names
   */
  convertPropertyNamesToSnakeCase(frontmatter: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(frontmatter)) {
      // Check if the key contains hyphens (kebab-case)
      if (key.includes('-')) {
        // Convert kebab-case to snake_case
        const snakeCaseKey = key.replace(/-/g, '_');
        console.log(`Converting property name from '${key}' to '${snakeCaseKey}'`);
        result[snakeCaseKey] = value;
      } else {
        // Keep the original key
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Get all registered templates
   * @returns Array of all registered templates
   */
  getAllTemplates(): MetadataTemplate[] {
    // Convert the Map values to an array
    return Array.from(this.templates.values());
  }

  /**
   * Check if a file path matches a specific template
   * @param filePath The path to the file
   * @param templateId The ID of the template to check
   * @returns True if the file matches the template, false otherwise
   */
  doesFileMatchTemplate(filePath: string, templateId: string): boolean {
    // Normalize path for matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Get the template by ID
    const template = this.templates.get(templateId);
    if (!template) {
      console.log(`Template with ID ${templateId} not found`);
      return false;
    }
    
    // Check directory patterns
    if (template.appliesTo.directories) {
      for (const pattern of template.appliesTo.directories) {
        // For absolute paths, check if they contain the pattern
        if (normalizedPath.includes(pattern)) {
          console.log(`File ${normalizedPath} matches template ${templateId} with pattern ${pattern}`);
          return true;
        }
        
        // Also try the direct minimatch for relative paths
        if (minimatch(normalizedPath, pattern)) {
          console.log(`File ${normalizedPath} matches template ${templateId} with pattern ${pattern}`);
          return true;
        }
      }
    }
    
    // Check file patterns
    if (template.appliesTo.filePatterns) {
      for (const pattern of template.appliesTo.filePatterns) {
        if (minimatch(path.basename(normalizedPath), pattern)) {
          console.log(`File ${normalizedPath} matches template ${templateId} with file pattern ${pattern}`);
          return true;
        }
      }
    }
    
    return false;
  }
}
