export function createLogRedactor(values: Array<string | undefined>) {
  const secrets = [...new Set(values.filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, encodeURIComponent(value)]))]
    .sort((a, b) => b.length - a.length);

  return (line: string) => {
    let safe = line;
    for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]');
    return safe.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+(@)/gi, '$1[REDACTED]$2');
  };
}
