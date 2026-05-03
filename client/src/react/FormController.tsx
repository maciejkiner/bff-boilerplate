import { useState } from 'react'
import type { FormEngine } from '../core/FormEngine.js'
import { useFormEngine } from './useFormEngine.js'
import { TextField } from './fields/TextField.js'
import { TextareaField } from './fields/TextareaField.js'
import { SelectField } from './fields/SelectField.js'
import { CheckboxField } from './fields/CheckboxField.js'
import type { FieldConfig } from '../core/types.js'

interface Props<T extends { id?: number }> {
  engine:       FormEngine<T>
  submitLabel?: string
  fields?:      FieldConfig[]  // override which fields to render (used by WizardController)
}

export function FormController<T extends { id?: number }>({
  engine,
  submitLabel = 'Save',
  fields: fieldOverride,
}: Props<T>) {
  const { fields: allFields, errors, isSubmitting, state, autosaving, lastSaved } = useFormEngine<T>(engine)
  const fields = fieldOverride ?? allFields

  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...(engine.values as Record<string, unknown>) })
  )

  const set = (name: string, value: unknown) => {
    const next = { ...values, [name]: value }
    setValues(next)
    engine.setValues({ [name]: value } as Partial<T>)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    engine.submit(values as T)
  }

  if (fields.length === 0 && state !== 'error') {
    return <div className="form-loading">Loading form…</div>
  }

  const rootError = errors['_root']?.[0]

  return (
    <form onSubmit={handleSubmit} noValidate>
      {rootError && <div role="alert" className="form-error">{rootError}</div>}

      {fields.map(field => {
        const error = errors[field.name]?.[0]
        const value = values[field.name]

        if (field.type === 'boolean') {
          return (
            <CheckboxField
              key={field.name}
              name={field.name}
              label={field.label}
              value={Boolean(value)}
              error={error}
              onChange={v => set(field.name, v)}
            />
          )
        }

        if (field.type === 'select') {
          return (
            <SelectField
              key={field.name}
              name={field.name}
              label={field.label}
              required={field.required}
              options={field.options}
              value={String(value ?? '')}
              error={error}
              onChange={v => set(field.name, v)}
            />
          )
        }

        if (field.type === 'textarea' || field.type === 'richtext') {
          return (
            <TextareaField
              key={field.name}
              name={field.name}
              label={field.label}
              placeholder={field.placeholder}
              required={field.required}
              value={String(value ?? '')}
              error={error}
              onChange={v => set(field.name, v)}
            />
          )
        }

        if (field.type === 'date') {
          return (
            <TextField
              key={field.name}
              name={field.name}
              label={field.label}
              type="date"
              placeholder={field.placeholder}
              required={field.required}
              value={String(value ?? '')}
              error={error}
              onChange={v => set(field.name, v)}
            />
          )
        }

        if (field.type === 'computed' || field.type === 'array' || field.type === 'group' || field.type === 'relation') {
          return (
            <div key={field.name} className="form-field form-field--unsupported">
              <label>{field.label}</label>
              <span className="form-field__hint">
                [{field.type} — not rendered; extend FormController to support this type]
              </span>
            </div>
          )
        }

        return (
          <TextField
            key={field.name}
            name={field.name}
            label={field.label}
            type={field.type}
            placeholder={field.placeholder}
            required={field.required}
            value={String(value ?? '')}
            error={error}
            onChange={v => set(field.name, v)}
          />
        )
      })}

      <div className="form-footer">
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
        {autosaving && <span className="form-autosave">Saving…</span>}
        {!autosaving && lastSaved && (
          <span className="form-autosave">
            Last saved {lastSaved.toLocaleTimeString()}
          </span>
        )}
      </div>
    </form>
  )
}
