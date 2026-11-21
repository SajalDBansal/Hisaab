import {
  newCustomFieldKey,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldKind,
} from "../customFields";
import type { VoucherType } from "../types";
import { clone, delay, getDb } from "./client";

/** What the custom field form sends (doc 37, T07). */
export interface CustomFieldInput {
  entity: CustomFieldEntity;
  name: string;
  kind: CustomFieldKind;
  choices: string[];
  required: boolean;
  active: boolean;
  print: boolean;
  voucherTypes: VoucherType[];
}

/** In-app demo of /v1/settings/custom-fields; the API applies the same rules. */
export const customFieldService = {
  /** Real API: GET /settings/custom-fields */
  async list(): Promise<CustomFieldDef[]> {
    await delay();
    return clone(getDb().customFieldDefs ?? []);
  },

  /** Real API: POST /settings/custom-fields, or PUT …/:id with If-Match. */
  async save(
    input: CustomFieldInput,
    id?: string,
    _version?: number,
  ): Promise<CustomFieldDef> {
    void _version;
    await delay();
    const db = getDb();
    const defs = (db.customFieldDefs ??= []);
    const name = input.name.trim();
    if (!name) throw new Error("Name the field.");
    if (
      defs.some(
        (d) =>
          d.id !== id &&
          d.entity === input.entity &&
          d.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("A field with this name already exists.");
    if (id) {
      const def = defs.find((d) => d.id === id);
      if (!def) throw new Error("That field was not found.");
      if (
        def.entity !== input.entity ||
        def.kind !== input.kind ||
        def.choices.some((c) => !input.choices.includes(c))
      )
        throw new Error(
          "A field's type, record and existing choices can't change; add new choices or make a new field.",
        );
      Object.assign(def, input, { name, version: def.version + 1 });
      return clone(def);
    }
    const def: CustomFieldDef = {
      ...input,
      name,
      id: `cf${Date.now().toString(36)}`,
      key: newCustomFieldKey(),
      position: defs.filter((d) => d.entity === input.entity).length,
      version: 1,
    };
    defs.push(def);
    return clone(def);
  },
};
