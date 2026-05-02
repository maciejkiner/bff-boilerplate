import { isEditable, isVisible } from '../form/FormDefinition.js'
import { flattenZodErrors } from '../form/validateForm.js'
import type { FieldDef, FieldMeta, FormContext, FormDefinition, ValidationContext } from '../form/types.js'

export interface TestValidationResult<TInput> {
  ok:     boolean
  data?:  TInput
  errors: Record<string, string[]>
}

export interface FormTestRunner<TInput extends Record<string, unknown>> {
  withContext(ctx: Partial<FormContext<TInput>>): FormTestRunner<TInput>
  validate(context?: ValidationContext): TestValidationResult<TInput>
  expectValid(): FormTestRunner<TInput>
  expectInvalid(): FormTestRunner<TInput>
  expectError(field: string, messageContains?: string): FormTestRunner<TInput>
  expectNoError(field: string): FormTestRunner<TInput>
  expectFieldVisible(field: keyof TInput & string): FormTestRunner<TInput>
  expectFieldHidden(field: keyof TInput & string): FormTestRunner<TInput>
  expectFieldEditable(field: keyof TInput & string): FormTestRunner<TInput>
  expectFieldReadonly(field: keyof TInput & string): FormTestRunner<TInput>
  schema(ctx?: Partial<FormContext<TInput>>): FieldMeta[]
}

export class FormTestKit {
  static fill<TInput extends Record<string, unknown>>(
    form: FormDefinition<TInput>,
    values: Partial<TInput>,
  ): FormTestRunner<TInput> {
    return new Runner(form, values, {})
  }
}

class Runner<TInput extends Record<string, unknown>> implements FormTestRunner<TInput> {
  constructor(
    private readonly form: FormDefinition<TInput>,
    private readonly values: Partial<TInput>,
    private readonly ctx: Partial<FormContext<TInput>>,
  ) {}

  withContext(ctx: Partial<FormContext<TInput>>): FormTestRunner<TInput> {
    return new Runner(this.form, this.values, { ...this.ctx, ...ctx })
  }

  validate(validationContext: ValidationContext = 'submit'): TestValidationResult<TInput> {
    const formCtx: FormContext<TInput> = {
      values: this.values,
      validationContext,
      ...(this.ctx.user ? { user: this.ctx.user } : {}),
    }
    const stripped: Record<string, unknown> = {}
    for (const field of this.form.fields) {
      if (!isVisible(field, formCtx)) continue
      if (!isEditable(field, formCtx)) continue
      if (field.type === 'computed') continue
      const key = field.name as string
      if (key in this.values) {
        stripped[key] = this.values[key as keyof TInput]
      } else if (field.defaultValue !== undefined) {
        stripped[key] = typeof field.defaultValue === 'function'
          ? (field.defaultValue as (c: FormContext<TInput>) => unknown)(formCtx)
          : field.defaultValue
      }
    }
    const parsed = this.form.toZodSchema(formCtx).safeParse(stripped)
    if (!parsed.success) {
      return { ok: false, errors: flattenZodErrors(parsed.error.issues) }
    }
    for (const rule of this.form.crossFieldRules) {
      const msg = rule.validate(parsed.data as Partial<TInput>, formCtx)
      if (msg !== null) {
        const key = rule.errorField ?? rule.fields[0] ?? '_root'
        return { ok: false, errors: { [key]: [msg] } }
      }
    }
    return { ok: true, data: parsed.data, errors: {} }
  }

  expectValid(): FormTestRunner<TInput> {
    const result = this.validate()
    if (!result.ok) throw new Error(`Expected form to be valid, got errors: ${JSON.stringify(result.errors)}`)
    return this
  }

  expectInvalid(): FormTestRunner<TInput> {
    const result = this.validate()
    if (result.ok) throw new Error('Expected form to be invalid, but it passed validation')
    return this
  }

  expectError(field: string, messageContains?: string): FormTestRunner<TInput> {
    const result = this.validate()
    const fieldErrors = result.errors[field]
    if (!fieldErrors?.length) {
      throw new Error(`Expected error on field '${field}', but got none. All errors: ${JSON.stringify(result.errors)}`)
    }
    if (messageContains) {
      const match = fieldErrors.some(m => m.includes(messageContains))
      if (!match) throw new Error(`Expected error on '${field}' to contain '${messageContains}', got: ${JSON.stringify(fieldErrors)}`)
    }
    return this
  }

  expectNoError(field: string): FormTestRunner<TInput> {
    const result = this.validate()
    const fieldErrors = result.errors[field]
    if (fieldErrors?.length) {
      throw new Error(`Expected no error on field '${field}', but got: ${JSON.stringify(fieldErrors)}`)
    }
    return this
  }

  expectFieldVisible(field: keyof TInput & string): FormTestRunner<TInput> {
    const fieldDef = this.findField(field)
    const ctx = this.buildCtx()
    if (!isVisible(fieldDef, ctx)) throw new Error(`Expected field '${field}' to be visible, but it is hidden`)
    return this
  }

  expectFieldHidden(field: keyof TInput & string): FormTestRunner<TInput> {
    const fieldDef = this.findField(field)
    const ctx = this.buildCtx()
    if (isVisible(fieldDef, ctx)) throw new Error(`Expected field '${field}' to be hidden, but it is visible`)
    return this
  }

  expectFieldEditable(field: keyof TInput & string): FormTestRunner<TInput> {
    const fieldDef = this.findField(field)
    const ctx = this.buildCtx()
    if (!isEditable(fieldDef, ctx)) throw new Error(`Expected field '${field}' to be editable, but it is readonly`)
    return this
  }

  expectFieldReadonly(field: keyof TInput & string): FormTestRunner<TInput> {
    const fieldDef = this.findField(field)
    const ctx = this.buildCtx()
    if (isEditable(fieldDef, ctx)) throw new Error(`Expected field '${field}' to be readonly, but it is editable`)
    return this
  }

  schema(ctx?: Partial<FormContext<TInput>>): FieldMeta[] {
    return this.form.toFieldMetas(ctx ?? this.buildCtx())
  }

  private findField(name: keyof TInput & string): FieldDef<TInput> {
    const field = this.form.fields.find(f => f.name === name)
    if (!field) throw new Error(`Field '${name}' not found in form definition`)
    return field
  }

  private buildCtx(): Partial<FormContext<TInput>> {
    return { values: this.values, validationContext: 'submit', ...this.ctx }
  }
}
