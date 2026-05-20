const fencedJsonPattern = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

export const extractSingleJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('generated_output_invalid_json');
  }

  const fencedMatch = fencedJsonPattern.exec(trimmed);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(candidate.includes('}{') || candidate.includes('} {') ? 'generated_output_ambiguous' : 'generated_output_invalid_json');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('generated_output_invalid_json');
  }

  return parsed;
};
