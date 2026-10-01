import fa from "./locales/fa.json";

export type MessageKey = keyof typeof fa;

export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)),
    fa[key],
  );
}

export function errorMessage(code: string): string {
  const key = `error.${code}` as MessageKey;
  return key in fa ? t(key) : t("error.UNKNOWN_ERROR");
}
