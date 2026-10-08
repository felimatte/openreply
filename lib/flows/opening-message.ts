/** The written alternative follows the same route as the opening button. */
export function openingFallbackText(text: string, label: string): string {
  return `${text.trimEnd()}\n\nRespondé ${label.trim()} para continuar.`;
}
