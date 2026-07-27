const ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const VARIABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const UNKNOWN_VARIABLE = Symbol('unknown template variable');

export interface TemplateContext {
  readonly variables?: ReadonlyMap<string, string | undefined>;
  readonly namespaces?: ReadonlyMap<string, ReadonlyMap<string, string> | undefined>;
}

export function renderTemplate(template: string, context: TemplateContext): string {
  let output = '';
  let cursor = 0;
  while (cursor < template.length) {
    const escapedStart = template.startsWith('\\{{', cursor);
    const start = escapedStart ? cursor + 1 : template.startsWith('{{', cursor) ? cursor : -1;
    if (start < 0) {
      output += template[cursor];
      cursor += 1;
      continue;
    }

    const end = template.indexOf('}}', start + 2);
    if (end < 0) {
      output += template.slice(cursor);
      break;
    }

    const source = template.slice(start, end + 2);
    if (escapedStart) {
      output += source;
    } else {
      const replacement = evaluateExpression(template.slice(start + 2, end), context);
      output += replacement === UNKNOWN_VARIABLE ? source : replacement;
    }
    cursor = end + 2;
  }
  return output;
}

function evaluateExpression(
  expression: string,
  context: TemplateContext
): string | typeof UNKNOWN_VARIABLE {
  const trimmed = expression.replace(ASCII_WHITESPACE, '');
  const separator = trimmed.indexOf(':-');
  const variable = (separator < 0 ? trimmed : trimmed.slice(0, separator)).replace(
    ASCII_WHITESPACE,
    ''
  );
  const fallback = separator < 0 ? undefined : trimmed.slice(separator + 2);
  if (!VARIABLE_PATTERN.test(variable)) return UNKNOWN_VARIABLE;

  const value = resolveVariable(variable, context);
  if (value === UNKNOWN_VARIABLE) return value;
  return value === undefined || value === '' ? (fallback ?? '') : value;
}

function resolveVariable(
  variable: string,
  context: TemplateContext
): string | undefined | typeof UNKNOWN_VARIABLE {
  if (context.variables?.has(variable)) {
    return context.variables.get(variable);
  }

  const separator = variable.indexOf('.');
  if (separator < 0) return UNKNOWN_VARIABLE;

  const namespace = variable.slice(0, separator);
  const key = variable.slice(separator + 1);
  if (!VARIABLE_PATTERN.test(key)) return UNKNOWN_VARIABLE;
  if (!context.namespaces?.has(namespace)) {
    return UNKNOWN_VARIABLE;
  }

  const values = context.namespaces.get(namespace);
  return values?.get(key);
}
