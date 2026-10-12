import type { ModelDescriptor, ModelRequirements } from '../catalog/ModelDescriptor.js';
import { CapabilityEvidenceManifest } from '../catalog/CapabilityEvidenceManifest.js';
import { ProviderError } from './ProviderErrors.js';

export interface NegotiationResult {
  eligible: boolean;
  score: number;
  rejectionReasons: string[];
}

export class CapabilityNegotiator {
  /**
   * Check if a model satisfies hard capability requirements
   */
  static evaluate(descriptor: ModelDescriptor, requirements: ModelRequirements): NegotiationResult {
    const rejectionReasons: string[] = [];
    const allowUnverified = Boolean(requirements.allowUnverified);

    // 0. Cryptographic Manifest Integrity Check for verified models
    if (descriptor.capabilitySource === 'verified-catalog' && descriptor.signedManifest) {
      const manifestCheck = CapabilityEvidenceManifest.verifyManifest(descriptor.signedManifest);
      if (!manifestCheck.valid) {
        rejectionReasons.push(`Cryptographic manifest verification failed: ${manifestCheck.reason}`);
      }
    }

    // 1. Tool calling check
    if (requirements.toolCalling === 'required') {
      if (descriptor.capabilities.toolCalling === 'unsupported') {
        rejectionReasons.push(`Model '${descriptor.modelId}' does not support required tool calling`);
      } else if (descriptor.capabilities.toolCalling === 'unknown' && !allowUnverified) {
        rejectionReasons.push(`Model '${descriptor.modelId}' tool calling capability is unverified and unconfirmed`);
      }
    }

    // 2. Streaming check
    if (requirements.streaming === 'required') {
      if (descriptor.capabilities.streaming === 'unsupported') {
        rejectionReasons.push(`Model '${descriptor.modelId}' does not support required streaming`);
      } else if (descriptor.capabilities.streaming === 'unknown' && !allowUnverified) {
        rejectionReasons.push(`Model '${descriptor.modelId}' streaming capability is unverified and unconfirmed`);
      }
    }

    // 3. Structured output check
    if (requirements.structuredOutput === 'required') {
      if (descriptor.capabilities.structuredOutput === 'unsupported') {
        rejectionReasons.push(`Model '${descriptor.modelId}' does not support required structured output`);
      } else if (descriptor.capabilities.structuredOutput === 'unknown' && !allowUnverified) {
        rejectionReasons.push(`Model '${descriptor.modelId}' structured output capability is unverified and unconfirmed`);
      }
    }

    // 4. Reasoning control check
    if (requirements.reasoningControl === 'required') {
      if (descriptor.capabilities.reasoningControl === 'unsupported') {
        rejectionReasons.push(`Model '${descriptor.modelId}' does not support required reasoning control`);
      } else if (descriptor.capabilities.reasoningControl === 'unknown' && !allowUnverified) {
        rejectionReasons.push(`Model '${descriptor.modelId}' reasoning control capability is unverified and unconfirmed`);
      }
    }

    // 5. Context window check
    if (requirements.minContextWindow && descriptor.contextWindow) {
      if (descriptor.contextWindow < requirements.minContextWindow) {
        rejectionReasons.push(
          `Model '${descriptor.modelId}' context window (${descriptor.contextWindow}) is smaller than required minimum (${requirements.minContextWindow})`
        );
      }
    }

    // 6. Input modality check
    if (requirements.inputModalities && requirements.inputModalities.length > 0) {
      for (const mod of requirements.inputModalities) {
        if (!descriptor.inputModalities.includes(mod)) {
          rejectionReasons.push(`Model '${descriptor.modelId}' does not support required input modality '${mod}'`);
        }
      }
    }

    const eligible = rejectionReasons.length === 0;
    const score = eligible ? CapabilityNegotiator.computeScore(descriptor, requirements) : 0;

    return { eligible, score, rejectionReasons };
  }

  /**
   * Filter and score a list of candidates, returning the best qualified model descriptor
   */
  static selectBest(candidates: ModelDescriptor[], requirements: ModelRequirements): ModelDescriptor {
    if (candidates.length === 0) {
      throw new ProviderError({
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'No candidate models provided for capability negotiation',
        retryable: false,
      });
    }

    const evaluations = candidates.map((cand) => ({
      descriptor: cand,
      result: CapabilityNegotiator.evaluate(cand, requirements),
    }));

    const eligibleList = evaluations.filter((item) => item.result.eligible);

    if (eligibleList.length === 0) {
      const summary = evaluations
        .map((e) => `[${e.descriptor.modelId}]: ${e.result.rejectionReasons.join('; ')}`)
        .join('\n');
      throw new ProviderError({
        code: 'UNSUPPORTED_CAPABILITY',
        message: `No model satisfies the required capabilities:\n${summary}`,
        retryable: false,
      });
    }

    // Sort descending by score
    eligibleList.sort((a, b) => b.result.score - a.result.score);
    return eligibleList[0].descriptor;
  }

  private static computeScore(descriptor: ModelDescriptor, requirements: ModelRequirements): number {
    let score = 50;

    // Reliability & verification tier
    if (descriptor.capabilitySource === 'verified-catalog') {
      score += 30;
    } else if (descriptor.capabilitySource === 'user-override') {
      score += 20;
    } else if (descriptor.capabilitySource === 'provider-api') {
      score += 10;
    } else {
      score -= 10; // Penalty for unverified / speculative
    }

    // Lifecycle status
    if (descriptor.lifecycle === 'stable') {
      score += 20;
    } else if (descriptor.lifecycle === 'preview') {
      score += 10;
    } else if (descriptor.lifecycle === 'deprecated') {
      score -= 40;
    }

    // Preferred capabilities bonus
    if (requirements.structuredOutput === 'preferred' && descriptor.capabilities.structuredOutput === 'supported') {
      score += 15;
    }
    if (requirements.reasoningControl === 'preferred' && descriptor.capabilities.reasoningControl === 'supported') {
      score += 15;
    }
    if (requirements.toolCalling === 'preferred' && descriptor.capabilities.toolCalling === 'supported') {
      score += 20;
    }

    // Context headroom bonus
    if (descriptor.contextWindow && descriptor.contextWindow >= 128000) {
      score += 10;
    }

    return score;
  }

  /**
   * Validate that a verified model descriptor carries valid provenance metadata
   */
  static validateProvenance(descriptor: ModelDescriptor, expectedAuthority?: string): boolean {
    if (descriptor.capabilitySource !== 'verified-catalog') {
      return true;
    }
    if (!descriptor.provenance) {
      return false;
    }
    if (expectedAuthority && descriptor.provenance.verifierAuthority !== expectedAuthority) {
      return false;
    }
    return Boolean(descriptor.provenance.verifiedAt && descriptor.provenance.configurationVersion);
  }

  /**
   * Cryptographically verify capability manifest against InterShader Trust Root
   */
  static verifySignedManifest(descriptor: ModelDescriptor): { valid: boolean; reason?: string } {
    if (descriptor.capabilitySource !== 'verified-catalog') {
      return { valid: true };
    }
    if (!descriptor.signedManifest) {
      return { valid: false, reason: 'MISSING_SIGNED_MANIFEST' };
    }
    return CapabilityEvidenceManifest.verifyManifest(descriptor.signedManifest);
  }
}
