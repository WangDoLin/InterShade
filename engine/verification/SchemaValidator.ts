import fs from 'node:fs';
import path from 'node:path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BundleValidationResult {
  valid: boolean;
  results: Record<string, ValidationResult>;
}

/**
 * Independent schema validator for supply chain attestation artifacts.
 * Validates in-toto Statement v1, in-toto Link v0.3, in-toto Test Result v0.1,
 * and SLSA Provenance v1 according to official specifications.
 */
export class SchemaValidator {
  private static readonly SHA256_REGEX = /^[a-f0-9]{64}$/i;

  /**
   * Validate generic in-toto Statement v1 envelope.
   * Specification: https://in-toto.io/Statement/v1
   */
  static validateInTotoStatement(statement: any): ValidationResult {
    const errors: string[] = [];

    if (!statement || typeof statement !== 'object') {
      return { valid: false, errors: ['Statement must be a valid JSON object'] };
    }

    if (statement._type !== 'https://in-toto.io/Statement/v1') {
      errors.push(`Invalid _type: expected "https://in-toto.io/Statement/v1", got "${statement._type}"`);
    }

    if (!Array.isArray(statement.subject) || statement.subject.length === 0) {
      errors.push('Statement subject must be a non-empty array');
    } else {
      statement.subject.forEach((sub: any, idx: number) => {
        if (!sub || typeof sub !== 'object') {
          errors.push(`subject[${idx}] must be an object`);
          return;
        }
        if (typeof sub.name !== 'string' || sub.name.trim() === '') {
          errors.push(`subject[${idx}].name must be a non-empty string`);
        }
        if (!sub.digest || typeof sub.digest !== 'object' || Object.keys(sub.digest).length === 0) {
          errors.push(`subject[${idx}].digest must be a non-empty dictionary`);
        } else if (sub.digest.sha256 && !SchemaValidator.SHA256_REGEX.test(sub.digest.sha256)) {
          errors.push(`subject[${idx}].digest.sha256 must be a 64-character lowercase hex string`);
        }
      });
    }

    if (typeof statement.predicateType !== 'string' || statement.predicateType.trim() === '') {
      errors.push('Statement predicateType must be a non-empty string URI');
    }

    if (!statement.predicate || typeof statement.predicate !== 'object') {
      errors.push('Statement predicate must be a non-empty object');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate in-toto Link v0.3 predicate.
   * Specification: https://in-toto.io/attestation/link/v0.3
   */
  static validateInTotoLinkV03(statement: any): ValidationResult {
    const base = this.validateInTotoStatement(statement);
    const errors = [...base.errors];

    if (statement.predicateType !== 'https://in-toto.io/attestation/link/v0.3') {
      errors.push(`predicateType must be "https://in-toto.io/attestation/link/v0.3", got "${statement.predicateType}"`);
    }

    const predicate = statement.predicate;
    if (predicate) {
      if (typeof predicate.name !== 'string' || predicate.name.trim() === '') {
        errors.push('predicate.name must be a non-empty string');
      }

      if (predicate.materials !== undefined) {
        if (!Array.isArray(predicate.materials)) {
          errors.push('predicate.materials must be an array');
        } else {
          predicate.materials.forEach((mat: any, idx: number) => {
            if (!mat || typeof mat !== 'object') {
              errors.push(`predicate.materials[${idx}] must be an object`);
              return;
            }
            if (typeof mat.name !== 'string') {
              errors.push(`predicate.materials[${idx}].name must be a string`);
            }
            if (!mat.digest || typeof mat.digest !== 'object') {
              errors.push(`predicate.materials[${idx}].digest must be an object`);
            }
          });
        }
      }

      // Check for incorrect camelCase byProducts
      if (predicate.byProducts !== undefined) {
        errors.push('Found "byProducts": in-toto Link v0.3 strictly requires lowercase "byproducts"');
      }

      if (predicate.byproducts !== undefined && (typeof predicate.byproducts !== 'object' || predicate.byproducts === null)) {
        errors.push('predicate.byproducts must be an object');
      }

      // In link/v0.3 with Statement v1, predicate.products is deprecated in favor of Statement.subject
      if (predicate.products !== undefined) {
        errors.push('predicate.products should be omitted in favor of Statement.subject in link/v0.3');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate in-toto Test Result v0.1 predicate.
   * Specification: https://in-toto.io/attestation/test-result/v0.1
   */
  static validateInTotoTestResultV01(statement: any): ValidationResult {
    const base = this.validateInTotoStatement(statement);
    const errors = [...base.errors];

    if (statement.predicateType !== 'https://in-toto.io/attestation/test-result/v0.1') {
      errors.push(`predicateType must be "https://in-toto.io/attestation/test-result/v0.1", got "${statement.predicateType}"`);
    }

    const predicate = statement.predicate;
    if (predicate) {
      const allowedResults = ['PASSED', 'FAILED', 'ERROR', 'SKIPPED'];
      if (!allowedResults.includes(predicate.result)) {
        errors.push(`predicate.result must be one of [${allowedResults.join(', ')}], got "${predicate.result}"`);
      }

      if (!Array.isArray(predicate.passedTests)) {
        errors.push('predicate.passedTests must be an array of strings');
      } else {
        predicate.passedTests.forEach((testName: any, idx: number) => {
          if (typeof testName !== 'string') {
            errors.push(`predicate.passedTests[${idx}] must be a string`);
          } else if (/^G\d+-G\d+/.test(testName)) {
            errors.push(`predicate.passedTests[${idx}] has redundant prefix: "${testName}"`);
          }
        });
      }

      if (!Array.isArray(predicate.warnedTests)) {
        errors.push('predicate.warnedTests must be an array');
      }

      if (!Array.isArray(predicate.failedTests)) {
        errors.push('predicate.failedTests must be an array');
      }

      if (predicate.configuration !== undefined && !Array.isArray(predicate.configuration)) {
        errors.push('predicate.configuration must be an array of ResourceDescriptors');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate SLSA Provenance v1 predicate.
   * Specification: https://slsa.dev/spec/v1.2/provenance and https://slsa.dev/provenance/v1
   */
  static validateSlsaProvenanceV1(statement: any): ValidationResult {
    const base = this.validateInTotoStatement(statement);
    const errors = [...base.errors];

    if (statement.predicateType !== 'https://slsa.dev/provenance/v1') {
      errors.push(`predicateType must be "https://slsa.dev/provenance/v1", got "${statement.predicateType}"`);
    }

    const predicate = statement.predicate;
    if (predicate) {
      if (!predicate.buildDefinition || typeof predicate.buildDefinition !== 'object') {
        errors.push('predicate.buildDefinition is required');
      } else {
        const bd = predicate.buildDefinition;
        if (typeof bd.buildType !== 'string' || bd.buildType.trim() === '') {
          errors.push('buildDefinition.buildType must be a non-empty URI string');
        }

        if (!bd.externalParameters || typeof bd.externalParameters !== 'object') {
          errors.push('buildDefinition.externalParameters must be an object');
        }

        if (!bd.internalParameters || typeof bd.internalParameters !== 'object') {
          errors.push('buildDefinition.internalParameters must be an object');
        } else {
          // Verification telemetry MUST NOT leak into buildDefinition.internalParameters
          const forbiddenTelemetry = [
            'totalGatesEvaluated',
            'overallPassed',
            'riskScore',
            'score',
            'challenge',
            'oracleKeyId',
          ];
          for (const key of forbiddenTelemetry) {
            if (bd.internalParameters[key] !== undefined) {
              errors.push(
                `buildDefinition.internalParameters must NOT contain verification telemetry field "${key}". Verification telemetry belongs in test-result or intershader attestation.`
              );
            }
          }
        }

        if (!Array.isArray(bd.resolvedDependencies)) {
          errors.push('buildDefinition.resolvedDependencies must be an array');
        } else {
          bd.resolvedDependencies.forEach((dep: any, idx: number) => {
            if (!dep || typeof dep !== 'object') {
              errors.push(`resolvedDependencies[${idx}] must be an object`);
            } else if (!dep.digest || typeof dep.digest !== 'object') {
              errors.push(`resolvedDependencies[${idx}].digest is required`);
            }
          });
        }
      }

      if (!predicate.runDetails || typeof predicate.runDetails !== 'object') {
        errors.push('predicate.runDetails is required');
      } else {
        const rd = predicate.runDetails;
        if (!rd.builder || typeof rd.builder.id !== 'string') {
          errors.push('runDetails.builder.id must be a valid URI string');
        }
        if (!rd.metadata || typeof rd.metadata !== 'object') {
          errors.push('runDetails.metadata is required');
        } else {
          if (typeof rd.metadata.invocationId !== 'string') {
            errors.push('runDetails.metadata.invocationId must be a string');
          }
          if (typeof rd.metadata.startedOn !== 'string') {
            errors.push('runDetails.metadata.startedOn must be an ISO date string');
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate SignedBundleIndex schema.
   */
  static validateBundleIndex(index: any): ValidationResult {
    const errors: string[] = [];
    if (!index || typeof index !== 'object') {
      return { valid: false, errors: ['bundle-index must be an object'] };
    }
    if (index._type !== 'https://intershader.dev/bundle-index/v1') {
      errors.push(`Invalid _type: expected "https://intershader.dev/bundle-index/v1", got "${index._type}"`);
    }
    if (typeof index.runId !== 'string') errors.push('runId must be string');
    if (typeof index.bundleDigestSha256 !== 'string' || !SchemaValidator.SHA256_REGEX.test(index.bundleDigestSha256)) {
      errors.push('bundleDigestSha256 must be a 64-char hex string');
    }
    if (typeof index.signatureHex !== 'string' || index.signatureHex.trim() === '') {
      errors.push('signatureHex must be non-empty string');
    }
    if (!index.files || typeof index.files !== 'object' || Object.keys(index.files).length === 0) {
      errors.push('files must be a non-empty dictionary');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a file physically located on disk against the matching attestation schema.
   */
  static validateFileOnDisk(filePath: string): ValidationResult {
    if (!fs.existsSync(filePath)) {
      return { valid: false, errors: [`File does not exist on disk: ${filePath}`] };
    }

    let parsed: any;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      parsed = JSON.parse(raw);
    } catch (err: any) {
      return { valid: false, errors: [`Invalid JSON syntax in ${filePath}: ${err.message}`] };
    }

    const basename = path.basename(filePath);
    if (basename === 'bundle-index.json' || parsed._type === 'https://intershader.dev/bundle-index/v1') {
      return this.validateBundleIndex(parsed);
    }

    if (basename === 'intoto-statement.json' || parsed.predicateType === 'https://in-toto.io/attestation/link/v0.3') {
      return this.validateInTotoLinkV03(parsed);
    }

    if (basename === 'in-toto-test-result.json' || parsed.predicateType === 'https://in-toto.io/attestation/test-result/v0.1') {
      return this.validateInTotoTestResultV01(parsed);
    }

    if (
      basename.startsWith('slsa-provenance') ||
      parsed.predicateType === 'https://slsa.dev/provenance/v1'
    ) {
      return this.validateSlsaProvenanceV1(parsed);
    }

    return this.validateInTotoStatement(parsed);
  }

  /**
   * Validate all export bundles generated on disk in the exports directory.
   */
  static validateBundleOnDisk(exportsDir: string): BundleValidationResult {
    const requiredFiles = [
      'bundle-index.json',
      'intoto-statement.json',
      'in-toto-test-result.json',
      'slsa-provenance-v1.2.json',
      'slsa-provenance-v1.0.json',
    ];

    const results: Record<string, ValidationResult> = {};
    let allValid = true;

    for (const file of requiredFiles) {
      const targetPath = path.join(exportsDir, file);
      const res = this.validateFileOnDisk(targetPath);
      results[file] = res;
      if (!res.valid) {
        allValid = false;
      }
    }

    return {
      valid: allValid,
      results,
    };
  }
}
