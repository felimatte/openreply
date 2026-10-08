import type { FlowDefinition } from "./definition";

export interface MessageVariable {
  key: string;
  label: string;
  description: string;
  source: "instagram" | "contact" | "flow";
}
export interface MessageField { key: string; label: string }
export interface SlashQuery { start: number; end: number; query: string }

const BASE_VARIABLES: MessageVariable[] = [
  { key: "username", label: "Usuario de Instagram", description: "Nombre de usuario, sin @. No es el nombre completo del perfil.", source: "instagram" },
  { key: "comment", label: "Comentario inicial", description: "El comentario que inició este flujo.", source: "instagram" },
  { key: "email", label: "Email guardado", description: "Disponible si ya guardaste el email del contacto.", source: "contact" },
  { key: "phone", label: "Teléfono guardado", description: "Disponible si ya guardaste el teléfono del contacto.", source: "contact" },
];
const safeKey = (key: string) => /^[a-zA-Z0-9_.:-]+$/.test(key) && !["constructor", "prototype", "__proto__"].includes(key);

export function getMessageVariables(definition: FlowDefinition, fields: readonly MessageField[] = []): MessageVariable[] {
  const variables = new Map(BASE_VARIABLES.map((variable) => [variable.key, { ...variable }]));
  for (const field of fields) {
    if (safeKey(field.key) && !variables.has(field.key)) variables.set(field.key, {
      key: field.key, label: field.label || field.key,
      description: "Campo del contacto. Disponible cuando tenga un valor guardado.", source: "contact",
    });
  }
  for (const node of definition.nodes) {
    const key = node.type === "input" ? node.data.fieldKey
      : node.type === "action" && ["set_field", "increment_field"].includes(node.data.action) ? node.data.fieldKey : undefined;
    if (key && safeKey(key) && !variables.has(key)) variables.set(key, {
      key, label: key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
      description: `Se guarda en «${node.label}». Usalo después de recibir ese dato.`, source: "flow",
    });
  }
  return [...variables.values()];
}

export function getSlashQuery(value: string, selectionStart: number, selectionEnd = selectionStart): SlashQuery | null {
  if (selectionStart !== selectionEnd || selectionStart < 0 || selectionStart > value.length) return null;
  const match = value.slice(0, selectionStart).match(/(?:^|[\s(])\/([\p{L}\p{N}_.:-]*)$/u);
  return match ? { start: selectionStart - match[1].length - 1, end: selectionStart, query: match[1] } : null;
}

const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function filterMessageVariables(variables: readonly MessageVariable[], query: string): MessageVariable[] {
  const needle = searchable(query);
  const rank = (variable: MessageVariable) => {
    const label = searchable(variable.label), key = searchable(variable.key);
    return label.startsWith(needle) || key.startsWith(needle) ? 0 : label.includes(needle) || key.includes(needle) ? 1 : 2;
  };
  return variables.filter((variable) => searchable(`${variable.label} ${variable.key} ${variable.description}`).includes(needle))
    .sort((a, b) => rank(a) - rank(b));
}

export function insertMessageVariable(value: string, query: SlashQuery, key: string): { value: string; caret: number } {
  const token = `{{${key}}}`;
  return { value: value.slice(0, query.start) + token + value.slice(query.end), caret: query.start + token.length };
}
