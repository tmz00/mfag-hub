export const normalizeAttachedSuffix = (value?: string | null): string =>
  String(value ?? "").trim();

const uniqueNonEmpty = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const raw of values) {
    const value = normalizeAttachedSuffix(raw);
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }

  return output;
};

export const appendAttachedSuffixTokens = (
  baseText: string,
  suffixes: string[],
): string => {
  let output = String(baseText || "").trim();
  const normalizedOutput = () => output.toLowerCase();

  for (const suffix of uniqueNonEmpty(suffixes)) {
    if (output && normalizedOutput().includes(suffix.toLowerCase())) {
      continue;
    }
    output = output ? `${output} ${suffix}` : suffix;
  }

  return output;
};

export const appendAttachedSuffixesFromRiders = (
  baseShortName: string,
  riders: Array<{ attachedSuffix?: string | null }>,
): string => {
  const suffixes = riders.map((rider) => normalizeAttachedSuffix(rider.attachedSuffix));
  return appendAttachedSuffixTokens(baseShortName, suffixes);
};

export const appendAttachedSuffixesByRiderProductId = (
  baseShortName: string,
  riders: Array<{ productId?: string | null }>,
  suffixByRiderProductId: Record<string, string>,
): string => {
  const suffixes: string[] = [];

  for (const rider of riders) {
    const riderId = String(rider.productId || "").trim();
    if (!riderId) continue;
    const suffix = normalizeAttachedSuffix(suffixByRiderProductId[riderId]);
    if (!suffix) continue;
    suffixes.push(suffix);
  }

  return appendAttachedSuffixTokens(baseShortName, suffixes);
};
