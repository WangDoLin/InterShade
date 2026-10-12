import { z } from 'zod';

/**
 * Converts Zod Schema to standard JSON Schema for Anthropic, OpenAI, and Gemini tool calling
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(shape)) {
      const field = val as z.ZodTypeAny;
      properties[key] = convertZodField(field);

      if (!field.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object', properties: {} };
}

function convertZodField(field: z.ZodTypeAny): Record<string, unknown> {
  let description = field.description;
  let current: z.ZodTypeAny = field;

  if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    current = current.unwrap();
    if (!description && current.description) {
      description = current.description;
    }
  }

  if (current instanceof z.ZodString) {
    return { type: 'string', description };
  }
  if (current instanceof z.ZodNumber) {
    return { type: 'number', description };
  }
  if (current instanceof z.ZodBoolean) {
    return { type: 'boolean', description };
  }
  if (current instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convertZodField(current.element),
      description,
    };
  }
  if (current instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: current._def.values,
      description,
    };
  }
  if (current instanceof z.ZodObject) {
    const schema = zodToJsonSchema(current);
    if (description) {
      schema.description = description;
    }
    return schema;
  }

  return { type: 'string', description };
}
