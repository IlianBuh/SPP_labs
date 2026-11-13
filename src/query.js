import { GraphQLError, Kind, buildASTSchema, getNamedType, getNullableType, isListType, getVariableValues, valueFromASTUntyped } from 'graphql';
import { catalogTypeDefs, workspaceTypeDefs } from './schema.js';
import { limits } from './limits.js';

export function badInput(message) { throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } }); }
export function boundedInt(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) badInput(`${name}: допустимо целое число от ${min} до ${max}`);
  return value;
}
export function cleanText(value, max, name) {
  const text = value.trim();
  if (!text || text.length > max) badInput(`${name}: длина от 1 до ${max}`);
  return text;
}
export function entryQuery(filter = {}, sort = {}, page = 1, pageSize = 20) {
  boundedInt(page, 1, 5000, 'page'); boundedInt(pageSize, 1, limits.page, 'pageSize');
  const query = {};
  if (filter.search?.trim()) query.$text = { $search: cleanText(filter.search, 200, 'search') };
  if (filter.kind) query.kind = filter.kind;
  if (filter.sourceId) query.sourceId = filter.sourceId;
  if (filter.tag) query.tags = cleanText(filter.tag, 100, 'tag');
  for (const [field, min, max] of [['year', filter.minYear, filter.maxYear], ['value', filter.minValue, filter.maxValue]]) {
    if (min != null && max != null && min > max) badInput(`Минимум ${field} больше максимума`);
    if (min != null || max != null) query[field] = { ...(min != null ? { $gte: min } : {}), ...(max != null ? { $lte: max } : {}) };
  }
  const field = { TITLE: 'title', YEAR: 'year', VALUE: 'value', UPDATED_AT: 'updatedAt' }[sort.field || 'TITLE'];
  if (!field) badInput('Неизвестное поле сортировки');
  const direction = sort.direction === 'DESC' ? -1 : 1;
  return { query, sort: { [field]: direction, _id: direction }, skip: (page - 1) * pageSize, limit: pageSize };
}
// Merge the API type definitions for standalone cost tests. At runtime Apollo's
// composed API schema is used, including GraphQL's variable coercion/defaults.
const definitions = new Map();
for (const d of [...catalogTypeDefs.definitions, ...workspaceTypeDefs.definitions]) {
  if (!d.name) continue;
  const previous = definitions.get(d.name.value);
  const fields = d.fields ? [...new Map([...(previous?.fields || []), ...d.fields].map(f => [f.name.value, f])).values()] : undefined;
  definitions.set(d.name.value, { ...d, directives: [], ...(fields ? { fields } : {}) });
}
const costSchema = buildASTSchema({ kind: Kind.DOCUMENT, definitions: [...definitions.values()] });
const fixedLists = {
  'Entry.authors': limits.authors, 'Entry.tags': limits.tags,
  'BookDetails.languages': limits.languages, 'CountryDetails.languages': limits.languages, 'CountryDetails.capital': limits.capital,
  'Query.sources': limits.sources, 'CatalogStats.sources': limits.sources, 'CatalogStats.kinds': 3,
  'Query.importJobs': limits.jobs, 'ImportJob.progress': limits.sources, 'Diagnostics.services': 4, 'Diagnostics.spans': limits.spans,
};
export function operationCost(document, operation, variables = {}, schema = costSchema) {
  const resolved = getVariableValues(schema, operation.variableDefinitions || [], variables || {});
  if (resolved.errors) throw resolved.errors[0];
  variables = resolved.coerced;
  const fragments = new Map(document.definitions.filter(d => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]));
  const argument = (node, name, fallback, max) => {
    const value = node.arguments?.find(a => a.name.value === name)?.value;
    return boundedInt(value ? valueFromASTUntyped(value, variables) : fallback, 1, max, name);
  };
  const tooComplex = () => { throw new GraphQLError('Превышена максимальная стоимость 50000', { extensions: { code: 'QUERY_TOO_COMPLEX' } }); };
  function walk(set, type, depth, pageSize = 20, path = new Set()) {
    if (depth > 10 || path.size > 50) throw new GraphQLError('Превышена максимальная глубина запроса или цепочки фрагментов', { extensions: { code: 'QUERY_TOO_COMPLEX' } });
    let cost = 0, maxDepth = depth;
    for (const node of set?.selections || []) {
      if (node.directives?.some(d => (d.name.value === 'skip' && valueFromASTUntyped(d.arguments[0].value, variables) === true) || (d.name.value === 'include' && valueFromASTUntyped(d.arguments[0].value, variables) === false))) continue;
      if (node.kind === Kind.FRAGMENT_SPREAD) {
        if (path.has(node.name.value)) badInput('Циклический фрагмент');
        const fragment = fragments.get(node.name.value);
        const result = walk(fragment?.selectionSet, schema.getType(fragment?.typeCondition.name.value) || type, depth, pageSize, new Set([...path, node.name.value]));
        cost += result.cost; maxDepth = Math.max(maxDepth, result.depth);
        if (cost > 50000) tooComplex();
        continue;
      }
      if (node.kind === Kind.INLINE_FRAGMENT) {
        const result = walk(node.selectionSet, node.typeCondition ? schema.getType(node.typeCondition.name.value) : type, depth, pageSize, path); cost += result.cost; maxDepth = Math.max(maxDepth, result.depth);
        if (cost > 50000) tooComplex();
        continue;
      }
      const field = type?.getFields?.()[node.name.value];
      const coordinate = `${type?.name}.${node.name.value}`;
      const childPageSize = coordinate === 'Query.entries' ? argument(node, 'pageSize', 20, limits.page) : pageSize;
      const child = walk(node.selectionSet, field && getNamedType(field.type), depth + 1, childPageSize, path);
      let multiplier = 1;
      if (field && isListType(getNullableType(field.type))) {
        if (coordinate === 'EntryPage.items') multiplier = pageSize;
        else if (coordinate === 'Query.collections') multiplier = argument(node, 'limit', limits.collections, limits.collections);
        else if (coordinate === 'Collection.items') multiplier = argument(node, 'limit', limits.items, limits.items);
        else if (coordinate === 'Entry.notes') multiplier = argument(node, 'limit', limits.notes, limits.notes);
        else multiplier = fixedLists[coordinate] ?? 1000; // conservative for introspection/new unbounded lists
      }
      cost += multiplier * (1 + child.cost);
      if (cost > 50000) tooComplex();
      maxDepth = Math.max(maxDepth, child.depth);
    }
    return { cost, depth: maxDepth };
  }
  return walk(operation.selectionSet, operation.operation === 'mutation' ? schema.getMutationType() : schema.getQueryType(), 0);
}
