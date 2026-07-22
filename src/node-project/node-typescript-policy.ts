import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { load } from "js-yaml";
import ts from "typescript";

export type NodeTypeScriptPolicyIssue = {
  code:
    | "policy.invalid"
    | "source.line-too-long"
    | "source.function-too-long"
    | "source.file-too-long"
    | "source.function-too-complex";
  path: string;
  message: string;
};

export type NodeTypeScriptPolicyCheckResult = {
  ok: boolean;
  issues: NodeTypeScriptPolicyIssue[];
};

export type CheckNodeTypeScriptPolicyOptions = {
  rootDir: string;
  standardsPath?: string;
  sourcePaths?: string[];
};

type NodeTypeScriptPolicy = {
  scope: {
    includeDirectories: string[];
    excludeDirectories: string[];
  };
  limits: {
    maxLineLength: number;
    maxFunctionLines: number;
    maxFileLines: number;
    maxCyclomaticComplexity: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${path} 必须是非空字符串数组。`);
  }
  return value.map((item) => item as string);
}

function readPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} 必须是正整数。`);
  }
  return value;
}

function parsePolicy(value: unknown): NodeTypeScriptPolicy {
  const root = asRecord(value);
  const scope = asRecord(root?.scope);
  const limits = asRecord(root?.limits);
  if (scope === null || limits === null) {
    throw new Error("规范必须包含 scope 和 limits。");
  }
  return {
    scope: {
      includeDirectories: readStringArray(scope.includeDirectories, "scope.includeDirectories"),
      excludeDirectories: readStringArray(scope.excludeDirectories, "scope.excludeDirectories"),
    },
    limits: {
      maxLineLength: readPositiveInteger(limits.maxLineLength, "limits.maxLineLength"),
      maxFunctionLines: readPositiveInteger(limits.maxFunctionLines, "limits.maxFunctionLines"),
      maxFileLines: readPositiveInteger(limits.maxFileLines, "limits.maxFileLines"),
      maxCyclomaticComplexity: readPositiveInteger(
        limits.maxCyclomaticComplexity,
        "limits.maxCyclomaticComplexity",
      ),
    },
  };
}

function parseFrontMatter(source: string): unknown {
  const lines = source.split(/\r?\n/u);
  if (lines[0] !== "---") {
    throw new Error("Node.js TypeScript 规范缺少 YAML Front Matter。 ");
  }
  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) {
    throw new Error("Node.js TypeScript 规范 YAML Front Matter 缺少结束标记。 ");
  }
  return load(lines.slice(1, endIndex).join("\n"));
}

async function loadPolicy(path: string): Promise<NodeTypeScriptPolicy> {
  return parsePolicy(parseFrontMatter(await readFile(path, "utf8")));
}

function isTypeScriptSourceFile(path: string): boolean {
  return /\.(?:[cm]?ts)$/u.test(path) && !path.endsWith(".d.ts");
}

function isInsideDirectory(rootDir: string, path: string): boolean {
  return path === rootDir || path.startsWith(`${rootDir}${sep}`);
}

async function collectSourceFiles(
  directory: string,
  excludeDirectories: ReadonlySet<string>,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludeDirectories.has(entry.name)) {
        files.push(...(await collectSourceFiles(path, excludeDirectories)));
      }
    } else if (entry.isFile() && isTypeScriptSourceFile(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function functionLabel(node: ts.FunctionLikeDeclaration): string {
  if (node.name !== undefined && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return "匿名函数";
}

const CONTROL_FLOW_DECISIONS: ReadonlyArray<(node: ts.Node) => boolean> = [
  ts.isIfStatement,
  ts.isForStatement,
  ts.isForInStatement,
  ts.isForOfStatement,
  ts.isWhileStatement,
  ts.isDoStatement,
  ts.isConditionalExpression,
  ts.isCatchClause,
  ts.isCaseClause,
];

function isBooleanDecision(node: ts.Node): boolean {
  return (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)
  );
}

function isDecisionNode(node: ts.Node): boolean {
  return CONTROL_FLOW_DECISIONS.some((predicate) => predicate(node)) || isBooleanDecision(node);
}

function cyclomaticComplexity(functionNode: ts.FunctionLikeDeclaration): number {
  let complexity = 1;
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionLike(node)) {
      return;
    }
    if (isDecisionNode(node)) {
      complexity += 1;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(functionNode, visit);
  return complexity;
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

function relativePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split("\\").join("/");
}

function functionLineLimitMessage(
  label: string,
  start: number,
  end: number,
  actual: number,
  limit: number,
): string {
  return `${label}（第 ${String(start)}-${String(end)} 行）共 ${String(actual)} 行，` +
    `超过上限 ${String(limit)} 行。`;
}

function complexityLimitMessage(label: string, line: number, actual: number, limit: number): string {
  return `${label}（第 ${String(line)} 行）圈复杂度 ${String(actual)}，超过上限 ${String(limit)}。`;
}

function isInPolicyScope(path: string, policy: NodeTypeScriptPolicy): boolean {
  const segments = path.split(/[\\/]/u);
  const first = segments[0];
  return (
    first !== undefined &&
    policy.scope.includeDirectories.includes(first) &&
    !segments.some((segment) => policy.scope.excludeDirectories.includes(segment))
  );
}

function inspectFile(
  rootDir: string,
  path: string,
  policy: NodeTypeScriptPolicy,
): NodeTypeScriptPolicyIssue[] {
  const source = ts.sys.readFile(path) ?? "";
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const issues: NodeTypeScriptPolicyIssue[] = [];
  const displayPath = relativePath(rootDir, path);
  const lines = source.split("\n");

  if (lineCount(source) > policy.limits.maxFileLines) {
    issues.push({
      code: "source.file-too-long",
      path: displayPath,
      message: `文件共 ${String(lineCount(source))} 行，超过上限 ${String(policy.limits.maxFileLines)} 行。`,
    });
  }

  for (const [index, line] of lines.entries()) {
    if (line.length > policy.limits.maxLineLength) {
      issues.push({
        code: "source.line-too-long",
        path: displayPath,
        message: `第 ${String(index + 1)} 行长度 ${String(line.length)}，超过上限 ${String(policy.limits.maxLineLength)}。`,
      });
    }
  }

  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const linesInFunction = end - start + 1;
      const label = functionLabel(node);
      if (linesInFunction > policy.limits.maxFunctionLines) {
        issues.push({
          code: "source.function-too-long",
          path: displayPath,
          message: functionLineLimitMessage(
            label,
            start,
            end,
            linesInFunction,
            policy.limits.maxFunctionLines,
          ),
        });
      }
      const complexity = cyclomaticComplexity(node);
      if (complexity > policy.limits.maxCyclomaticComplexity) {
        issues.push({
          code: "source.function-too-complex",
          path: displayPath,
          message: complexityLimitMessage(
            label,
            start,
            complexity,
            policy.limits.maxCyclomaticComplexity,
          ),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

export async function checkNodeTypeScriptPolicy(
  options: CheckNodeTypeScriptPolicyOptions,
): Promise<NodeTypeScriptPolicyCheckResult> {
  const rootDir = resolve(options.rootDir);
  const standardsPath = resolve(
    options.standardsPath ?? join(rootDir, "harness/workflows/node-typescript-standards/STANDARDS.md"),
  );
  let policy: NodeTypeScriptPolicy;
  try {
    policy = await loadPolicy(standardsPath);
  } catch (error: unknown) {
    return {
      ok: false,
      issues: [
        {
          code: "policy.invalid",
          path: relativePath(rootDir, standardsPath),
          message:
            error instanceof Error
              ? `无法加载 Node.js TypeScript 标准：${error.message}`
              : "无法加载 Node.js TypeScript 标准。",
        },
      ],
    };
  }

  const files =
    options.sourcePaths === undefined
      ? (
          await Promise.all(
            policy.scope.includeDirectories.map((directory) =>
              collectSourceFiles(join(rootDir, directory), new Set(policy.scope.excludeDirectories)),
            ),
          )
        ).flat()
      : options.sourcePaths.flatMap((sourcePath) => {
          const path = resolve(rootDir, sourcePath);
          const displayPath = relativePath(rootDir, path);
          return isInsideDirectory(rootDir, path) &&
            isTypeScriptSourceFile(path) &&
            isInPolicyScope(displayPath, policy)
            ? [path]
            : [];
        });
  const issues = files.flatMap((path) => inspectFile(rootDir, path, policy));
  return { ok: issues.length === 0, issues };
}
