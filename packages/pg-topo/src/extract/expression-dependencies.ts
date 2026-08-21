import {
  type Visitor as SqlAstVisitor,
  walk as walkSqlAst,
} from "@pgsql/traverse";
import {
  parseSync as parsePlpgsqlScriptSync,
  parseSql as parseSqlScriptSync,
  walk as walkPlpgsqlAst,
} from "plpgsql-parser";
import {
  createObjectRef,
  createObjectRefFromAst,
  DEFAULT_SCHEMA,
  isBuiltInObjectRef,
  splitQualifiedName,
} from "../model/object-ref.ts";
import type { ObjectRef } from "../model/types.ts";
import { asRecord } from "../utils/ast.ts";
import {
  extractNameParts,
  extractStringValue,
  objectFromNameParts,
  relationFromRangeVarNode,
  typeFromTypeNameNode,
} from "./shared-refs.ts";

type ExpressionDependencyOptions = {
  qualifiedOnly: boolean;
};

const signaturePartFromTypeRef = (typeRef: ObjectRef): string =>
  typeRef.kind === "type" &&
  typeRef.schema?.toLowerCase() === "pg_catalog" &&
  typeRef.explicitSchema === true
    ? `${typeRef.schema}.${typeRef.name}`
    : isBuiltInObjectRef(typeRef)
      ? typeRef.name
      : typeRef.schema
        ? `${typeRef.schema}.${typeRef.name}`
        : typeRef.name;

const typeCastNodeFromExpression = (
  expressionNode: unknown,
): Record<string, unknown> | undefined => {
  const expressionRecord = asRecord(expressionNode);
  if (!expressionRecord) {
    return undefined;
  }

  const wrappedTypeCast = asRecord(expressionRecord.TypeCast);
  if (wrappedTypeCast) {
    return wrappedTypeCast;
  }

  if (
    expressionRecord.arg !== undefined &&
    expressionRecord.typeName !== undefined
  ) {
    return expressionRecord;
  }

  return undefined;
};

const aConstNodeFromExpression = (
  expressionNode: unknown,
): Record<string, unknown> | undefined => {
  const expressionRecord = asRecord(expressionNode);
  if (!expressionRecord) {
    return undefined;
  }

  const wrappedConst = asRecord(expressionRecord.A_Const);
  if (wrappedConst) {
    return wrappedConst;
  }

  const hasAnyConstField =
    expressionRecord.isnull !== undefined ||
    expressionRecord.sval !== undefined ||
    expressionRecord.ival !== undefined ||
    expressionRecord.fval !== undefined ||
    expressionRecord.boolval !== undefined;
  return hasAnyConstField ? expressionRecord : undefined;
};

const unwrapNamedArgumentExpression = (expressionNode: unknown): unknown => {
  const expressionRecord = asRecord(expressionNode);
  if (!expressionRecord) {
    return expressionNode;
  }

  const namedArgument = asRecord(expressionRecord.NamedArgExpr);
  if (namedArgument?.arg !== undefined) {
    return namedArgument.arg;
  }

  return expressionNode;
};

const inferConstSignaturePart = (
  constNode: Record<string, unknown>,
): string => {
  if (constNode.isnull === true) {
    return "unknown";
  }

  const boolNode = asRecord(constNode.boolval);
  if (
    typeof boolNode?.boolval === "boolean" ||
    typeof constNode.boolval === "boolean"
  ) {
    return "bool";
  }

  const intNode = asRecord(constNode.ival);
  if (typeof intNode?.ival === "number" || typeof constNode.ival === "number") {
    return "int4";
  }

  const floatNode = asRecord(constNode.fval);
  if (
    typeof floatNode?.fval === "number" ||
    typeof floatNode?.fval === "string"
  ) {
    return "numeric";
  }
  if (
    typeof constNode.fval === "number" ||
    typeof constNode.fval === "string"
  ) {
    return "numeric";
  }

  // String literals are "unknown" until PostgreSQL resolves overloads.
  return "unknown";
};

const inferFunctionCallArgumentSignaturePart = (
  argumentNode: unknown,
): string => {
  const unwrappedNode = unwrapNamedArgumentExpression(argumentNode);

  const typeCastNode = typeCastNodeFromExpression(unwrappedNode);
  if (typeCastNode) {
    const typeRef = typeFromTypeNameNode(typeCastNode.typeName);
    if (typeRef) {
      return signaturePartFromTypeRef(typeRef);
    }
  }

  const constNode = aConstNodeFromExpression(unwrappedNode);
  if (constNode) {
    return inferConstSignaturePart(constNode);
  }

  return "unknown";
};

const inferFunctionCallSignature = (
  functionCallNode: Record<string, unknown>,
): string => {
  const args = Array.isArray(functionCallNode.args)
    ? functionCallNode.args
    : [];
  const signatureParts = args.map((argNode) =>
    inferFunctionCallArgumentSignaturePart(argNode),
  );
  return `(${signatureParts.join(",")})`;
};

const createSqlDependencyVisitor = (
  requires: ObjectRef[],
  options: ExpressionDependencyOptions,
): SqlAstVisitor => ({
  RangeVar: (path) => {
    const rangeVarRecord = asRecord(path.node);
    if (
      options.qualifiedOnly &&
      typeof rangeVarRecord?.schemaname !== "string"
    ) {
      return;
    }
    const tableRef = relationFromRangeVarNode(rangeVarRecord, "table");
    if (tableRef) {
      requires.push(tableRef);
    }
  },
  TypeName: (path) => {
    const typeNameRecord = asRecord(path.node);
    if (options.qualifiedOnly) {
      const nameParts = extractNameParts(typeNameRecord?.names);
      if (nameParts.length < 2) {
        return;
      }
      const typeRef = objectFromNameParts("type", nameParts, undefined);
      if (typeRef) {
        requires.push(typeRef);
      }
      return;
    }

    const typeRef = typeFromTypeNameNode(typeNameRecord);
    if (typeRef) {
      requires.push(typeRef);
    }
  },
  FuncCall: (path) => {
    const functionCallRecord = asRecord(path.node);
    const nameParts = extractNameParts(functionCallRecord?.funcname);
    if (options.qualifiedOnly && nameParts.length < 2) {
      return;
    }

    const functionRefBase = objectFromNameParts("function", nameParts);
    if (functionRefBase) {
      const functionSignature = inferFunctionCallSignature(
        functionCallRecord ?? {},
      );
      requires.push(
        createObjectRefFromAst(
          "function",
          functionRefBase.name,
          functionRefBase.schema,
          functionSignature,
        ),
      );
    }

    if (options.qualifiedOnly) {
      return;
    }

    const functionName = nameParts.at(-1);
    if (functionName !== "nextval") {
      return;
    }

    const args = Array.isArray(functionCallRecord?.args)
      ? functionCallRecord.args
      : [];
    const firstArg = args[0];
    const typeCastNode = asRecord(asRecord(firstArg)?.TypeCast);
    const constNode = asRecord(asRecord(typeCastNode?.arg)?.A_Const);
    const constValue = asRecord(constNode?.sval)?.sval;

    if (typeof constValue !== "string") {
      return;
    }

    const { schema, name } = splitQualifiedName(constValue, "raw");
    requires.push(createObjectRef("sequence", name, schema ?? DEFAULT_SCHEMA));
  },
});

const addExpressionDependenciesWithOptions = (
  expressionNode: unknown,
  requires: ObjectRef[],
  options: ExpressionDependencyOptions,
): void => {
  try {
    walkSqlAst(expressionNode, createSqlDependencyVisitor(requires, options));
  } catch {
    // Ignore traversal errors so extraction remains best-effort.
  }
};

export const addExpressionDependencies = (
  expressionNode: unknown,
  requires: ObjectRef[],
): void => {
  addExpressionDependenciesWithOptions(expressionNode, requires, {
    qualifiedOnly: false,
  });
};

const addQualifiedExpressionDependencies = (
  expressionNode: unknown,
  requires: ObjectRef[],
): void => {
  addExpressionDependenciesWithOptions(expressionNode, requires, {
    qualifiedOnly: true,
  });
};

const functionOptionElements = (
  statementNode: Record<string, unknown>,
): Record<string, unknown>[] => {
  const options = Array.isArray(statementNode.options)
    ? statementNode.options
    : [];
  const items: Record<string, unknown>[] = [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (defElem) {
      items.push(defElem);
    }
  }
  return items;
};

const extractRoutineLanguage = (
  statementNode: Record<string, unknown>,
): string | null => {
  for (const defElem of functionOptionElements(statementNode)) {
    if (defElem.defname !== "language") {
      continue;
    }
    const languageName = extractStringValue(defElem.arg);
    if (languageName) {
      return languageName.toLowerCase();
    }
  }
  return null;
};

const extractRoutineBodySqlBlocks = (
  statementNode: Record<string, unknown>,
): string[] => {
  const blocks: string[] = [];
  for (const defElem of functionOptionElements(statementNode)) {
    if (defElem.defname !== "as") {
      continue;
    }

    const argRecord = asRecord(defElem.arg);
    const listItems = asRecord(argRecord?.List)?.items;
    if (Array.isArray(listItems)) {
      for (const item of listItems) {
        const itemValue = extractStringValue(item);
        if (itemValue && itemValue.trim().length > 0) {
          blocks.push(itemValue);
        }
      }
      continue;
    }

    const singleValue = extractStringValue(defElem.arg);
    if (singleValue && singleValue.trim().length > 0) {
      blocks.push(singleValue);
    }
  }
  return blocks;
};

const pickPlpgsqlDelimiter = (bodyBlock: string): string => {
  for (let index = 0; index < 10; index += 1) {
    const candidate = `$pg_declare_body_${index}$`;
    if (!bodyBlock.includes(candidate)) {
      return candidate;
    }
  }
  return "$pg_declare_body$";
};

const addHydratedPlpgsqlDependencies = (
  hydratedPlpgsqlAst: unknown,
  requires: ObjectRef[],
): void => {
  try {
    walkPlpgsqlAst(hydratedPlpgsqlAst, () => {}, {
      walkSqlExpressions: true,
      sqlVisitor: createSqlDependencyVisitor(requires, { qualifiedOnly: true }),
    });
  } catch {
    // Ignore traversal errors so extraction remains best-effort.
  }
};

const addSqlRoutineBodyDependencies = (
  bodyBlock: string,
  requires: ObjectRef[],
): void => {
  const parsedBody = parseSqlScriptSync(bodyBlock) as {
    stmts?: Array<{ stmt?: unknown }>;
  };
  const statements = Array.isArray(parsedBody?.stmts) ? parsedBody.stmts : [];
  for (const parsedStatement of statements) {
    const statementAst = asRecord(parsedStatement)?.stmt;
    if (statementAst) {
      addQualifiedExpressionDependencies(statementAst, requires);
    }
  }
};

const addPlpgsqlRoutineBodyDependencies = (
  bodyBlock: string,
  requires: ObjectRef[],
): void => {
  const delimiter = pickPlpgsqlDelimiter(bodyBlock);
  const syntheticFunctionSql = [
    "create function pg_temp.__pg_declare_probe__() returns void",
    "language plpgsql",
    `as ${delimiter}`,
    bodyBlock,
    `${delimiter};`,
  ].join("\n");

  const parsedFunctionScript = parsePlpgsqlScriptSync(syntheticFunctionSql, {
    hydrate: true,
  }) as {
    functions?: Array<{ plpgsql?: { hydrated?: unknown } }>;
  };

  const parsedFunction =
    Array.isArray(parsedFunctionScript?.functions) &&
    parsedFunctionScript.functions.length > 0
      ? parsedFunctionScript.functions[0]
      : undefined;
  const hydratedPlpgsqlAst = asRecord(
    asRecord(parsedFunction)?.plpgsql,
  )?.hydrated;
  if (hydratedPlpgsqlAst) {
    addHydratedPlpgsqlDependencies(hydratedPlpgsqlAst, requires);
  }
};

export const addRoutineBodyDependencies = (
  statementNode: Record<string, unknown>,
  requires: ObjectRef[],
): void => {
  const languageName = extractRoutineLanguage(statementNode);
  if (languageName !== "sql" && languageName !== "plpgsql") {
    return;
  }

  const bodyBlocks = extractRoutineBodySqlBlocks(statementNode);
  for (const bodyBlock of bodyBlocks) {
    try {
      if (languageName === "sql") {
        addSqlRoutineBodyDependencies(bodyBlock, requires);
      } else {
        addPlpgsqlRoutineBodyDependencies(bodyBlock, requires);
      }
    } catch {
      // Keep extraction resilient for bodies that are not parseable as SQL snippets.
    }
  }
};
