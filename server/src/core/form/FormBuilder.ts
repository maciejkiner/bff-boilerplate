import { z } from 'zod'
import type { BuiltForm, FieldMeta, FieldType, UniqueCheck } from './types.js'

type InternalFieldConfig = {
  schema: z.ZodTypeAny
  fieldType: FieldType
  label: string
  placeholder?: string
  required: boolean
  options?: { value: string; label: string }[]
  uniqueCheck?: UniqueCheck
}

export class FormBuilder<TShape extends Record<string, unknown>> {
  private fields: Record<string, InternalFieldConfig> = {}
  private currentField: string | null = null

  field(name: keyof TShape & string): this {
    this.currentField = name
    this.fields[name] = { schema: z.string(), fieldType: 'text', label: name, required: false }
    return this
  }

  label(text: string): this {
    this.current().label = text
    return this
  }

  placeholder(text: string): this {
    this.current().placeholder = text
    return this
  }

  required(): this {
    this.current().required = true
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.min(1, 'Required') : s
    )
  }

  optional(): this {
    this.current().required = false
    return this.updateSchema(s => s.optional().or(z.literal('')).optional())
  }

  minLength(n: number): this {
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.min(n, `Min ${n} characters`) : s
    )
  }

  maxLength(n: number): this {
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.max(n, `Max ${n} characters`) : s
    )
  }

  isEmail(): this {
    this.current().fieldType = 'email'
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.email('Invalid email') : s
    )
  }

  isUrl(): this {
    this.current().fieldType = 'url'
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.url('Invalid URL') : s
    )
  }

  asTextarea(): this {
    this.current().fieldType = 'textarea'
    return this
  }

  isNumber(): this {
    this.current().fieldType = 'number'
    return this.updateSchema(() => z.coerce.number())
  }

  isBoolean(): this {
    this.current().fieldType = 'boolean'
    return this.updateSchema(() => z.coerce.boolean())
  }

  isEnum(values: [string, ...string[]]): this {
    this.current().fieldType = 'select'
    this.current().options = values.map(v => ({ value: v, label: v }))
    return this.updateSchema(() => z.enum(values))
  }

  isUnique(table: string, column: string): this {
    const name = this.currentField!
    this.fields[name]!.uniqueCheck = { field: name, table, column }
    return this
  }

  custom(schema: z.ZodTypeAny): this {
    this.fields[this.currentField!]!.schema = schema
    return this
  }

  build(): BuiltForm<TShape> {
    const shape: Record<string, z.ZodTypeAny> = {}
    const uniqueChecks: UniqueCheck[] = []
    const fieldEntries = Object.entries(this.fields)

    for (const [name, config] of fieldEntries) {
      shape[name] = config.schema
      if (config.uniqueCheck) uniqueChecks.push(config.uniqueCheck)
    }

    const toFieldConfigs = (): FieldMeta[] =>
      fieldEntries.map(([name, config]) => {
        const meta: FieldMeta = {
          name,
          label: config.label,
          type:  config.fieldType,
        }
        if (config.placeholder) meta.placeholder = config.placeholder
        if (config.required)    meta.required    = config.required
        if (config.options)     meta.options     = config.options
        return meta
      })

    return {
      schema: z.object(shape) as unknown as z.ZodType<TShape>,
      uniqueChecks,
      toFieldConfigs,
    }
  }

  private current(): InternalFieldConfig {
    return this.fields[this.currentField!]!
  }

  private updateSchema(fn: (s: z.ZodTypeAny) => z.ZodTypeAny): this {
    this.current().schema = fn(this.current().schema)
    return this
  }
}
