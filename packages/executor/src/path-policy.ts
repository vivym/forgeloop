import { isAbsolute, win32 } from 'node:path';

export interface RawPathPolicy {
  allowed_paths?: readonly string[];
  forbidden_paths?: readonly string[];
  allow_all_repo?: boolean;
}

export interface PathPolicyCompileOptions {
  validationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  reviewedAllowAllRepo?: boolean;
  sourceMutationPolicy?: 'path_policy_scoped' | 'no_source_changes';
}

export interface ChangedPathInput {
  path: string;
  previous_path?: string;
  change_kind?: 'added' | 'modified' | 'deleted' | 'renamed';
}

export type PathPolicyRejectionCode = 'path_policy_declared_scope_rejected' | 'path_policy_actual_changes_rejected';

export type PathPolicyEvaluationResult =
  | { allowed: true }
  | { allowed: false; code: PathPolicyRejectionCode; path?: string; reason?: string };

export interface CompiledPathPolicy {
  evaluateChangedFile(input: ChangedPathInput): PathPolicyEvaluationResult;
  validateDeclaredScope(paths: readonly string[]): PathPolicyEvaluationResult;
}

export class PathPolicyError extends Error {
  constructor(
    readonly code: 'path_policy_invalid',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PathPolicyError';
  }
}

interface CompiledPattern {
  raw: string;
  normalized: string;
  segments: readonly string[];
}

interface PolicyLayer {
  allowed: 'all' | readonly CompiledPattern[];
  forbidden: readonly CompiledPattern[];
}

interface CompileLayerOptions {
  validationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  reviewedAllowAllRepo?: boolean | undefined;
  sourceMutationPolicy: 'path_policy_scoped' | 'no_source_changes';
}

const controlCharacterPattern = /[\x00-\x1f\x7f]/;
const extglobPattern = /(^|\/|[^\\])[@?!+*]\(/;
const regexSpecialPattern = /[\\^$+.()|[\]{}]/g;
const maxPatternLength = 1024;
const maxPatternSegments = 128;

const pathPolicyError = (message: string, details: Record<string, unknown> = {}) =>
  new PathPolicyError('path_policy_invalid', message, details);

const defaultCompileOptions: PathPolicyCompileOptions = {
  validationStrategy: 'checks_required',
};

export function compilePathPolicy(raw: RawPathPolicy, options: PathPolicyCompileOptions = defaultCompileOptions): CompiledPathPolicy {
  const sourceMutationPolicy = options.sourceMutationPolicy ?? 'path_policy_scoped';
  const layer = compileLayer(raw, {
    validationStrategy: options.validationStrategy,
    reviewedAllowAllRepo: options.reviewedAllowAllRepo,
    sourceMutationPolicy,
  });

  return new CompiledPathPolicyImpl([layer]);
}

export function compileEffectivePathPolicy(input: {
  packagePolicy: RawPathPolicy;
  snapshotPolicy: RawPathPolicy;
  packageValidationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  snapshotValidationStrategy: 'checks_required' | 'allow_all_repo' | 'custom';
  packageReviewedAllowAllRepo?: boolean;
  snapshotReviewedAllowAllRepo?: boolean;
  sourceMutationPolicy: 'path_policy_scoped' | 'no_source_changes';
}): CompiledPathPolicy {
  const packageLayer = compileLayer(input.packagePolicy, {
    validationStrategy: input.packageValidationStrategy,
    reviewedAllowAllRepo: input.packageReviewedAllowAllRepo,
    sourceMutationPolicy: input.sourceMutationPolicy,
  });
  const snapshotLayer = compileLayer(input.snapshotPolicy, {
    validationStrategy: input.snapshotValidationStrategy,
    reviewedAllowAllRepo: input.snapshotReviewedAllowAllRepo,
    sourceMutationPolicy: input.sourceMutationPolicy,
  });

  return new CompiledPathPolicyImpl([packageLayer, snapshotLayer]);
}

const compileLayer = (raw: RawPathPolicy, options: CompileLayerOptions): PolicyLayer => {
  const rawAllowAllRepo = raw.allow_all_repo === true;
  const allowRootWidePatterns =
    rawAllowAllRepo && options.validationStrategy === 'allow_all_repo' && options.reviewedAllowAllRepo === true;
  const allowedPaths = raw.allowed_paths ?? [];
  const forbiddenPaths = raw.forbidden_paths ?? [];
  const compiledAllowed = allowedPaths.map((pattern) => compilePattern(pattern, { allowRootWide: allowRootWidePatterns }));
  const compiledForbidden = forbiddenPaths.map((pattern) => compilePattern(pattern, { allowRootWide: allowRootWidePatterns }));

  if (options.sourceMutationPolicy === 'no_source_changes' && (rawAllowAllRepo || compiledAllowed.length > 0)) {
    throw pathPolicyError('no_source_changes requires deny-all source paths.', {
      allow_all_repo: rawAllowAllRepo,
      allowed_paths: allowedPaths,
    });
  }

  if (rawAllowAllRepo) {
    if (options.validationStrategy !== 'allow_all_repo') {
      throw pathPolicyError('allow_all_repo requires the allow_all_repo validation strategy.', {
        validationStrategy: options.validationStrategy,
      });
    }
    if (options.reviewedAllowAllRepo !== true) {
      throw pathPolicyError('allow_all_repo requires reviewed approval evidence.', {
        reviewedAllowAllRepo: options.reviewedAllowAllRepo,
      });
    }
    return {
      allowed: 'all',
      forbidden: compiledForbidden,
    };
  }

  return {
    allowed: compiledAllowed,
    forbidden: compiledForbidden,
  };
};

const compilePattern = (pattern: string, options: { allowRootWide: boolean }): CompiledPattern => {
  if (pattern.length === 0) {
    throw pathPolicyError('Path policy patterns must not be empty.', { pattern });
  }
  if (pattern.length > maxPatternLength) {
    throw pathPolicyError('Path policy patterns must not exceed the maximum length.', {
      pattern,
      maxPatternLength,
    });
  }
  if (pattern.trim() !== pattern) {
    throw pathPolicyError('Path policy patterns must not contain leading or trailing whitespace.', { pattern });
  }
  if (controlCharacterPattern.test(pattern)) {
    throw pathPolicyError('Path policy patterns must not contain control characters.', { pattern });
  }
  if (
    pattern === '.' ||
    pattern === '..' ||
    pattern.startsWith('/') ||
    isAbsolute(pattern) ||
    win32.isAbsolute(pattern) ||
    pattern.includes('\\')
  ) {
    throw pathPolicyError('Path policy patterns must be repo-relative POSIX paths.', { pattern });
  }
  if (pattern.startsWith('!')) {
    throw pathPolicyError('Path policy negation is disabled.', { pattern });
  }
  if (/[{}]/.test(pattern)) {
    throw pathPolicyError('Path policy brace expansion is disabled.', { pattern });
  }
  if (extglobPattern.test(pattern)) {
    throw pathPolicyError('Path policy extglob syntax is disabled.', { pattern });
  }

  const directoryPattern = pattern.endsWith('/');
  const normalized = normalizePattern(pattern);
  const segments = normalized.split('/');

  if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
    throw pathPolicyError('Path policy patterns must not contain empty or traversal segments.', { pattern });
  }
  if (!options.allowRootWide && isRootWidePattern(segments)) {
    throw pathPolicyError('Root-wide path policy patterns require reviewed allow_all_repo.', { pattern });
  }

  const effectiveSegments = canonicalizeGlobstarSegments(directoryPattern ? [...segments, '**'] : segments);
  if (effectiveSegments.length > maxPatternSegments) {
    throw pathPolicyError('Path policy patterns must not exceed the maximum segment count.', {
      pattern,
      maxPatternSegments,
    });
  }
  const effectivePattern = effectiveSegments.join('/');

  return {
    raw: pattern,
    normalized: effectivePattern,
    segments: effectiveSegments,
  };
};

const normalizePattern = (pattern: string): string => pattern.split('/').filter(Boolean).join('/');

const canonicalizeGlobstarSegments = (segments: readonly string[]): string[] => {
  const canonical: string[] = [];
  for (const segment of segments) {
    if (segment === '**' && canonical[canonical.length - 1] === '**') {
      continue;
    }
    canonical.push(segment);
  }
  return canonical;
};

const normalizeChangedPath = (path: string): string => {
  if (path.length === 0) {
    throw pathPolicyError('Changed paths must not be empty.', { path });
  }
  if (controlCharacterPattern.test(path)) {
    throw pathPolicyError('Changed paths must not contain control characters.', { path });
  }
  if (path === '.' || path === '..' || path.startsWith('/') || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\')) {
    throw pathPolicyError('Changed paths must be repo-relative POSIX paths.', { path });
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw pathPolicyError('Changed paths must not contain traversal segments.', { path });
  }

  return segments.join('/');
};

const isRootWidePattern = (segments: readonly string[]): boolean => {
  const firstSegment = segments[0];

  return firstSegment !== undefined && containsSegmentGlob(firstSegment);
};

const matchPattern = (pattern: CompiledPattern, normalizedPath: string): boolean => {
  const pathSegments = normalizedPath.split('/');

  return matchSegments(pattern.segments, pathSegments, 0, 0);
};

const matchSegments = (
  patternSegments: readonly string[],
  pathSegments: readonly string[],
  patternIndex: number,
  pathIndex: number,
): boolean => {
  const seen = new Map<string, boolean>();
  const visit = (currentPatternIndex: number, currentPathIndex: number): boolean => {
    const key = `${currentPatternIndex}:${currentPathIndex}`;
    const cached = seen.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = matchSegmentsUncached(patternSegments, pathSegments, currentPatternIndex, currentPathIndex, visit);
    seen.set(key, result);
    return result;
  };

  return visit(patternIndex, pathIndex);
};

const matchSegmentsUncached = (
  patternSegments: readonly string[],
  pathSegments: readonly string[],
  patternIndex: number,
  pathIndex: number,
  visit: (patternIndex: number, pathIndex: number) => boolean,
): boolean => {
  if (patternIndex === patternSegments.length) {
    return pathIndex === pathSegments.length;
  }

  const patternSegment = patternSegments[patternIndex];
  if (patternSegment === undefined) {
    return pathIndex === pathSegments.length;
  }

  if (patternSegment === '**') {
    if (patternIndex === patternSegments.length - 1) {
      return pathIndex < pathSegments.length && pathSegments.slice(pathIndex).every((segment) => !segment.startsWith('.'));
    }
    if (visit(patternIndex + 1, pathIndex)) {
      return true;
    }
    const pathSegment = pathSegments[pathIndex];
    return (
      pathSegment !== undefined &&
      !pathSegment.startsWith('.') &&
      visit(patternIndex, pathIndex + 1)
    );
  }

  const pathSegment = pathSegments[pathIndex];
  return (
    pathSegment !== undefined &&
    segmentMatches(patternSegment, pathSegment) &&
    visit(patternIndex + 1, pathIndex + 1)
  );
};

const segmentMatches = (patternSegment: string, pathSegment: string): boolean => {
  if (pathSegment.startsWith('.') && !patternSegment.startsWith('.')) {
    return false;
  }

  const regexSource = patternSegment
    .replace(regexSpecialPattern, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');

  return new RegExp(`^${regexSource}$`).test(pathSegment);
};

const containsSegmentGlob = (segment: string): boolean => segment.includes('*') || segment.includes('?');

const segmentSubsumes = (allowedSegment: string, declaredSegment: string): boolean => {
  if (declaredSegment === '**') {
    return allowedSegment === '**';
  }

  return !segmentDifferenceExists(declaredSegment, allowedSegment);
};

const segmentDifferenceExists = (includedPattern: string, excludingPattern: string): boolean => {
  const alphabet = segmentAlphabet(includedPattern, excludingPattern);
  const initialIncludedStates = epsilonClosureSegment(includedPattern, new Set([0]));
  const initialExcludingStates = epsilonClosureSegment(excludingPattern, new Set([0]));
  const seen = new Set<string>();

  const visit = (includedStates: ReadonlySet<number>, excludingStates: ReadonlySet<number>, consumed: boolean): boolean => {
    const key = `${stateKey(includedStates)}|${stateKey(excludingStates)}|${consumed ? '1' : '0'}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    if (
      consumed &&
      includedStates.has(includedPattern.length) &&
      !excludingStates.has(excludingPattern.length)
    ) {
      return true;
    }

    for (const char of alphabet) {
      if (!consumed && char === '.' && !includedPattern.startsWith('.')) {
        continue;
      }
      const nextIncludedStates = stepSegmentPattern(includedPattern, includedStates, char, consumed);
      if (nextIncludedStates.size === 0) {
        continue;
      }
      const nextExcludingStates = stepSegmentPattern(excludingPattern, excludingStates, char, consumed);
      if (visit(nextIncludedStates, nextExcludingStates, true)) {
        return true;
      }
    }

    return false;
  };

  return visit(initialIncludedStates, initialExcludingStates, false);
};

const segmentAlphabet = (...patterns: readonly string[]): Set<string> => {
  const alphabet = new Set(['\0']);
  for (const pattern of patterns) {
    for (const char of pattern) {
      if (char !== '*' && char !== '?') {
        alphabet.add(char);
      }
    }
  }

  return alphabet;
};

const stateKey = (states: ReadonlySet<number>): string => [...states].sort((left, right) => left - right).join(',');

const epsilonClosureSegment = (pattern: string, states: ReadonlySet<number>): Set<number> => {
  const closed = new Set(states);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of [...closed]) {
      if (pattern[state] === '*' && !closed.has(state + 1)) {
        closed.add(state + 1);
        changed = true;
      }
    }
  }

  return closed;
};

const stepSegmentPattern = (
  pattern: string,
  states: ReadonlySet<number>,
  char: string,
  consumed: boolean,
): Set<number> => {
  if (!consumed && char === '.' && !pattern.startsWith('.')) {
    return new Set();
  }

  const nextStates = new Set<number>();
  for (const state of states) {
    const token = pattern[state];
    if (token === '*') {
      nextStates.add(state);
      continue;
    }
    if (token === '?' || token === char) {
      nextStates.add(state + 1);
    }
  }

  return epsilonClosureSegment(pattern, nextStates);
};

const patternSubsumes = (allowed: CompiledPattern, declared: CompiledPattern): boolean =>
  patternSegmentsSubsume(allowed.segments, declared.segments, 0, 0);

const patternSegmentsSubsume = (
  allowedSegments: readonly string[],
  declaredSegments: readonly string[],
  allowedIndex: number,
  declaredIndex: number,
): boolean => {
  const seen = new Map<string, boolean>();
  const visit = (currentAllowedIndex: number, currentDeclaredIndex: number): boolean => {
    const key = `${currentAllowedIndex}:${currentDeclaredIndex}`;
    const cached = seen.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = patternSegmentsSubsumeUncached(
      allowedSegments,
      declaredSegments,
      currentAllowedIndex,
      currentDeclaredIndex,
      visit,
    );
    seen.set(key, result);
    return result;
  };

  return visit(allowedIndex, declaredIndex);
};

const patternSegmentsSubsumeUncached = (
  allowedSegments: readonly string[],
  declaredSegments: readonly string[],
  allowedIndex: number,
  declaredIndex: number,
  visit: (allowedIndex: number, declaredIndex: number) => boolean,
): boolean => {
  if (declaredIndex === declaredSegments.length) {
    return allowedIndex === allowedSegments.length;
  }

  const allowedSegment = allowedSegments[allowedIndex];
  const declaredSegment = declaredSegments[declaredIndex];
  if (allowedSegment === undefined || declaredSegment === undefined) {
    return false;
  }

  if (allowedSegment === '**' && declaredSegment === '**') {
    return visit(allowedIndex + 1, declaredIndex + 1) || visit(allowedIndex, declaredIndex + 1);
  }

  if (allowedSegment === '**') {
    if (allowedIndex === allowedSegments.length - 1) {
      return declaredSegments.slice(declaredIndex).every((segment) => !segment.startsWith('.'));
    }
    if (visit(allowedIndex + 1, declaredIndex)) {
      return true;
    }
    return declaredSegment !== '**' && !declaredSegment.startsWith('.') && visit(allowedIndex, declaredIndex + 1);
  }

  if (declaredSegment === '**') {
    return false;
  }

  return (
    segmentSubsumes(allowedSegment, declaredSegment) &&
    visit(allowedIndex + 1, declaredIndex + 1)
  );
};

const segmentPatternsMayOverlap = (left: string, right: string): boolean => {
  if ((left.startsWith('.') && !right.startsWith('.')) || (right.startsWith('.') && !left.startsWith('.'))) {
    return false;
  }

  const alphabet = new Set(['x']);
  for (const char of `${left}${right}`) {
    if (char !== '*' && char !== '?') {
      alphabet.add(char);
    }
  }
  const canStartWithDot = left.startsWith('.') && right.startsWith('.');
  const seen = new Set<string>();

  const visit = (leftIndex: number, rightIndex: number, consumed: boolean): boolean => {
    const key = `${leftIndex}:${rightIndex}:${consumed ? '1' : '0'}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    if (leftIndex === left.length && rightIndex === right.length) {
      return consumed;
    }

    if (left[leftIndex] === '*' && visit(leftIndex + 1, rightIndex, consumed)) {
      return true;
    }
    if (right[rightIndex] === '*' && visit(leftIndex, rightIndex + 1, consumed)) {
      return true;
    }

    for (const char of alphabet) {
      if (!consumed && char === '.' && !canStartWithDot) {
        continue;
      }

      const nextLeftIndex = consumeSegmentPatternChar(left, leftIndex, char);
      const nextRightIndex = consumeSegmentPatternChar(right, rightIndex, char);
      if (nextLeftIndex !== undefined && nextRightIndex !== undefined && visit(nextLeftIndex, nextRightIndex, true)) {
        return true;
      }
    }

    return false;
  };

  return visit(0, 0, false);
};

const consumeSegmentPatternChar = (pattern: string, index: number, char: string): number | undefined => {
  const token = pattern[index];
  if (token === undefined) {
    return undefined;
  }
  if (token === '*') {
    return index;
  }
  if (token === '?') {
    return index + 1;
  }
  return token === char ? index + 1 : undefined;
};

const patternsMayOverlap = (left: CompiledPattern, right: CompiledPattern): boolean =>
  patternSegmentsMayOverlap(left.segments, right.segments);

const patternSegmentsMayOverlap = (
  leftSegments: readonly string[],
  rightSegments: readonly string[],
): boolean => {
  const seen = new Set<string>();

  const visit = (leftIndex: number, rightIndex: number): boolean => {
    const key = `${leftIndex}:${rightIndex}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    if (leftIndex === leftSegments.length && rightIndex === rightSegments.length) {
      return true;
    }

    const leftSegment = leftSegments[leftIndex];
    const rightSegment = rightSegments[rightIndex];
    if (leftSegment === undefined || rightSegment === undefined) {
      return false;
    }

    if (leftSegment === '**' && rightSegment === '**') {
      return (
        (leftIndex < leftSegments.length - 1 && visit(leftIndex + 1, rightIndex)) ||
        (rightIndex < rightSegments.length - 1 && visit(leftIndex, rightIndex + 1)) ||
        visit(leftIndex + 1, rightIndex + 1) ||
        visit(leftIndex, rightIndex + 1) ||
        visit(leftIndex + 1, rightIndex)
      );
    }

    if (leftSegment === '**') {
      return (
        (leftIndex < leftSegments.length - 1 && visit(leftIndex + 1, rightIndex)) ||
        (!rightSegment.startsWith('.') && (visit(leftIndex + 1, rightIndex + 1) || visit(leftIndex, rightIndex + 1)))
      );
    }

    if (rightSegment === '**') {
      return (
        (rightIndex < rightSegments.length - 1 && visit(leftIndex, rightIndex + 1)) ||
        (!leftSegment.startsWith('.') && (visit(leftIndex + 1, rightIndex + 1) || visit(leftIndex + 1, rightIndex)))
      );
    }

    return segmentPatternsMayOverlap(leftSegment, rightSegment) && visit(leftIndex + 1, rightIndex + 1);
  };

  return visit(0, 0);
};

class CompiledPathPolicyImpl implements CompiledPathPolicy {
  constructor(private readonly layers: readonly PolicyLayer[]) {}

  evaluateChangedFile(input: ChangedPathInput): PathPolicyEvaluationResult {
    if (input.change_kind === 'renamed' && input.previous_path === undefined) {
      const invalidPathRejection = changedPathInputRejection(input.path, 'path_policy_actual_changes_rejected');
      if (invalidPathRejection !== undefined) {
        return invalidPathRejection;
      }

      return {
        allowed: false,
        code: 'path_policy_actual_changes_rejected',
        path: normalizeChangedPath(input.path),
        reason: 'Renamed changed-file records must include previous_path.',
      };
    }

    const paths = input.previous_path === undefined ? [input.path] : [input.previous_path, input.path];

    for (const path of paths) {
      const result = this.evaluatePath(path, 'path_policy_actual_changes_rejected');
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  }

  validateDeclaredScope(paths: readonly string[]): PathPolicyEvaluationResult {
    for (const path of paths) {
      const declaredPattern = declaredScopePatternOrRejection(path, this.layers.some((layer) => layer.allowed === 'all'));
      if (!declaredPattern.allowed) {
        return declaredPattern;
      }

      for (const layer of this.layers) {
        const forbiddenPattern = layer.forbidden.find((pattern) => patternsMayOverlap(pattern, declaredPattern.pattern));
        if (forbiddenPattern !== undefined) {
          return {
            allowed: false,
            code: 'path_policy_declared_scope_rejected',
            path: declaredPattern.pattern.normalized,
            reason: `Declared scope overlaps forbidden pattern ${forbiddenPattern.raw}.`,
          };
        }
      }

      for (const layer of this.layers) {
        if (layer.allowed === 'all') {
          continue;
        }
        const coveringPattern = layer.allowed.find((pattern) => patternSubsumes(pattern, declaredPattern.pattern));
        if (coveringPattern === undefined) {
          return {
            allowed: false,
            code: 'path_policy_declared_scope_rejected',
            path: declaredPattern.pattern.normalized,
            reason: 'Declared scope is broader than allowed paths.',
          };
        }
      }
    }

    return { allowed: true };
  }

  private evaluatePath(path: string, code: PathPolicyRejectionCode): PathPolicyEvaluationResult {
    const invalidPathRejection = changedPathInputRejection(path, code);
    if (invalidPathRejection !== undefined) {
      return invalidPathRejection;
    }
    const normalizedPath = normalizeChangedPath(path);

    for (const layer of this.layers) {
      const forbiddenPattern = layer.forbidden.find((pattern) => matchPattern(pattern, normalizedPath));
      if (forbiddenPattern !== undefined) {
        return {
          allowed: false,
          code,
          path: normalizedPath,
          reason: `Path matches forbidden pattern ${forbiddenPattern.raw}.`,
        };
      }
    }

    for (const layer of this.layers) {
      if (layer.allowed === 'all') {
        continue;
      }
      const allowedPattern = layer.allowed.find((pattern) => matchPattern(pattern, normalizedPath));
      if (allowedPattern === undefined) {
        return {
          allowed: false,
          code,
          path: normalizedPath,
          reason: 'Path is outside allowed paths.',
        };
      }
    }

    return { allowed: true };
  }
}

const changedPathInputRejection = (path: string, code: PathPolicyRejectionCode): PathPolicyEvaluationResult | undefined => {
  try {
    normalizeChangedPath(path);
    return undefined;
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return {
        allowed: false,
        code,
        reason: error.message,
      };
    }
    throw error;
  }
};

type DeclaredScopePatternResult =
  | { allowed: true; pattern: CompiledPattern }
  | { allowed: false; code: PathPolicyRejectionCode; reason: string };

const declaredScopePatternOrRejection = (path: string, allowRootWide: boolean): DeclaredScopePatternResult => {
  try {
    return { allowed: true, pattern: compilePattern(path, { allowRootWide }) };
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return {
        allowed: false,
        code: 'path_policy_declared_scope_rejected',
        reason: error.message,
      };
    }
    throw error;
  }
};
