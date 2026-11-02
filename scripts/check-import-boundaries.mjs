import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const rules = {
  domain: new Set(['domain']),
  application: new Set(['application', 'domain']),
  adapters: new Set(['adapters', 'application', 'domain']),
  presentation: new Set(['presentation', 'application', 'domain', 'assets']),
  composition: new Set([
    'composition',
    'presentation',
    'adapters',
    'application',
    'domain',
    'assets',
  ]),
};

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(entryPath);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function importedSpecifiers(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function layerFor(filePath, sourceRoot) {
  const [topLevel] = path.relative(sourceRoot, filePath).split(path.sep);
  return Object.hasOwn(rules, topLevel) ? topLevel : undefined;
}

export function boundaryViolations(sourceRoot) {
  const absoluteRoot = path.resolve(sourceRoot);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Source root does not exist: ${absoluteRoot}`);
  }

  const violations = [];
  for (const filePath of filesUnder(absoluteRoot)) {
    const sourceLayer = layerFor(filePath, absoluteRoot);
    if (!sourceLayer) {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );

    for (const specifier of importedSpecifiers(sourceFile)) {
      if (!specifier.startsWith('.')) {
        continue;
      }
      const targetPath = path.resolve(path.dirname(filePath), specifier);
      const targetLayer = layerFor(targetPath, absoluteRoot);
      if (targetLayer && !rules[sourceLayer].has(targetLayer)) {
        violations.push(
          `${path.relative(absoluteRoot, filePath)}: ${sourceLayer} must not import ${targetLayer} (${specifier})`,
        );
      }
    }
  }
  return violations;
}

function optionValue(name) {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex === -1) {
    return undefined;
  }
  const value = process.argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
}

const sourceRoot = optionValue('--root') ?? path.resolve('src');
const violations = boundaryViolations(sourceRoot);

if (violations.length > 0) {
  console.error(['Import boundary violations:', ...violations].join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Import boundaries passed for ${sourceRoot}`);
}
