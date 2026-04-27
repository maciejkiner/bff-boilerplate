import { z } from 'zod'
import type { BuiltForm, UniqueCheck } from './types.js'

type FieldConfig = {
  schema: z.ZodTypeAny
  uniqueCheck?: UniqueCheck
}

export class FormBuilder<TShape extends Record<string, unknown>> {
  private fields: Record<string, FieldConfig> = {}
  private currentField: string | null = null

  field(name: keyof TShape & string): this {
    this.currentField = name
    this.fields[name] = { schema: z.string() }
    return this
  }

  required(): this {
    return this.updateSchema(s => {
      if (s instanceof z.ZodString) return s.min(1, 'Required')
      return s
    })
  }

  optional(): this {
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
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.email('Invalid email') : s
    )
  }

  isUrl(): this {
    return this.updateSchema(s =>
      s instanceof z.ZodString ? s.url('Invalid URL') : s
    )
  }

  min(n: number): this {
    return this.updateSchema(s =>
      s instanceof z.ZodNumber ? s.min(n, `Min value is ${n}`) : s
    )
  }

  max(n: number): this {
    return this.updateSchema(s =>
      s instanceof z.ZodNumber ? s.max(n, `Max value is ${n}`) : s
    )
  }

  isNumber(): this {
    return this.updateSchema(() => z.coerce.number())
  }

  isBoolean(): this {
    return this.updateSchema(() => z.coerce.boolean())
  }

  isEnum(values: [string, ...string[]]): this {
    return this.updateSchema(() => z.enum(values))
  }

  isUnique(table: string, column: string): this {
    const name = this.currentField!
    const config = this.fields[name]!
    config.uniqueCheck = { field: name, table, column }
    return this
  }

  custom(schema: z.ZodTypeAny): this {
    const name = this.currentField!
    this.fields[name] = { ...this.fields[name]!, schema }
    return this
  }

  build(): BuiltForm<TShape> {
    const shape: Record<string, z.ZodTypeAny> = {}
    const uniqueChecks: UniqueCheck[] = []

    for (const [name, config] of Object.entries(this.fields)) {
      shape[name] = config.schema
      if (config.uniqueCheck) uniqueChecks.push(config.uniqueCheck)
    }

    return {
      schema: z.object(shape) as unknown as z.ZodType<TShape>,
      uniqueChecks,
    }
  }

  private updateSchema(fn: (s: z.ZodTypeAny) => z.ZodTypeAny): this {
    const name = this.currentField!
    const config = this.fields[name]!
    config.schema = fn(config.schema)
    return this
  }
}
