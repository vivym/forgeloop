import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const forbiddenClassTokens: RegExp[] = [
  /^fl-/,
  /^empty$/,
  /^metric$/,
  /^pill-list$/,
  /^state-grid$/,
  /^form-grid$/,
  /^button-row$/,
  /^danger-text$/,
  /^timeline-list$/,
  /^timeline-entry$/,
  /^artifact-list$/,
  /^detail-block$/,
  /^delivery-action-summary$/,
];

const scanRoots = ['apps/web/src', 'tests/web', 'tests/e2e'];

export function legacyRenderedClassTokens(root: ParentNode) {
  const rootElement = root instanceof HTMLElement && root.hasAttribute('class') ? [root] : [];
  return [...rootElement, ...root.querySelectorAll<HTMLElement>('[class]')].flatMap((element) =>
    [...element.classList].filter((token) => isForbiddenLegacyClassToken(token)),
  );
}

export function legacyClassTokenMatches() {
  return scanRoots
    .flatMap(textFiles)
    .filter((file) => !file.endsWith('no-legacy-web-ui.test.ts'))
    .filter((file) => !file.endsWith('helpers/no-legacy-class-scan.ts'))
    .flatMap((file) => forbiddenClassTokenMatches(file, readFileSync(file, 'utf8')));
}

export function forbiddenClassTokenMatches(file: string, source: string): string[] {
  return file.endsWith('.css') ? cssForbiddenTokenMatches(file, source) : tsForbiddenTokenMatches(file, source);
}

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path.includes('.react-router') || path.includes('/dist/') || path.includes('/node_modules/')) return [];
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(ts|tsx|css|html)$/.test(path) ? [path] : [];
  });
}

function tsForbiddenTokenMatches(file: string, source: string) {
  const matches: string[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node: ts.Node) {
    if (isClassSurface(node, sourceFile)) {
      collectStringValues(node).forEach((value) => pushForbiddenTokens(file, value, matches));
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

function isClassSurface(node: ts.Node, sourceFile: ts.SourceFile) {
  if (ts.isJsxAttribute(node)) {
    const name = node.name.getText(sourceFile);
    return name === 'className' || name === 'class';
  }
  if (ts.isPropertyAssignment(node)) {
    const name = propertyNameText(node.name);
    return name === 'className' || name === 'class';
  }
  if (ts.isVariableDeclaration(node)) {
    return /classes?|className/i.test(node.name.getText(sourceFile));
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(sourceFile).split('.').at(-1);
    return callee === 'cn' || callee === 'clsx' || callee === 'cva' || callee === 'querySelector' || callee === 'querySelectorAll';
  }
  return false;
}

function collectStringValues(node: ts.Node) {
  const values: string[] = [];

  function visit(child: ts.Node) {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
      values.push(child.text);
      return;
    }
    if (ts.isTemplateExpression(child)) {
      values.push(child.head.text);
      child.templateSpans.forEach((span) => values.push(span.literal.text));
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return values;
}

function cssForbiddenTokenMatches(file: string, source: string) {
  const matches: string[] = [];
  for (const match of source.matchAll(/\.([A-Za-z][\w-]*)\b/g)) {
    pushForbiddenTokens(file, match[1] ?? '', matches);
  }
  return matches;
}

function pushForbiddenTokens(file: string, value: string, matches: string[]) {
  for (const token of classTokens(value)) {
    if (isForbiddenLegacyClassToken(token)) {
      matches.push(`${file}: ${token}`);
    }
  }
}

function isForbiddenLegacyClassToken(token: string) {
  return forbiddenClassTokens.some((forbidden) => forbidden.test(classTokenBase(token)));
}

function classTokens(value: string): string[] {
  return value
    .split(/[\s"'`,()[\]{}]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^[.#]/, ''))
    .map(classTokenBase);
}

function classTokenBase(token: string) {
  return (token.split(':').at(-1) ?? token).replace(/^!/, '');
}

function propertyNameText(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}
