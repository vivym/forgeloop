import { describe, expect, it } from 'vitest';

import { extractSingleJsonObject } from '../../packages/codex-runtime/src/json-output';

describe('extractSingleJsonObject', () => {
  it('extracts one raw JSON object', () => {
    expect(extractSingleJsonObject('{"schema_version":"plan_draft.v1","summary":"ok"}')).toEqual({
      schema_version: 'plan_draft.v1',
      summary: 'ok',
    });
  });

  it('extracts one fenced JSON object', () => {
    expect(extractSingleJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it.each([
    ['empty text', ''],
    ['non-json text', 'no json'],
    ['concatenated objects', '{"a":1} {"b":2}'],
    ['JSON plus trailing prose', '{"a":1}\ncontradictory prose'],
  ])('rejects %s', (_caseName, text) => {
    expect(() => extractSingleJsonObject(text)).toThrow(
      /generated_output_invalid_json|generated_output_ambiguous/,
    );
  });
});
