export function format(first?: string, middle?: string, last?: string): string {
  return (first || '') + (middle ? ` ${middle}` : '') + (last ? ` ${last}` : '');
}

// Regular expression to match ENVELOPE syntax in bbox strings
export const ENVELOPE_REGEX = /^ENVELOPE\((?<west>[^,]+),(?<east>[^,]+),(?<north>[^,]+),(?<south>[^,]+)\)$/;
