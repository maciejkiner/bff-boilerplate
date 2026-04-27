import { useState } from 'react'
import type { FormEngine } from '../core/FormEngine.js'
import { useFormEngine } from './useFormEngine.js'
import { TextField } from './fields/TextField.js'
import { TextareaField } from './fields/TextareaField.js'
import { SelectField } from './fields/SelectField.js'
import { CheckboxField } from './fields/CheckboxField.js'

interface Props<T extends { id?: number }> {
  engine: FormEngine<T>
  submitLabel?: string
}

export function FormController<T extends { id?: number }>({
  engine,
  submitLabel = 'Save',
}: Props<T>) {
  const { fields, errors, isSubmitting, state } = useFormEngine<T>(engine)

  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...(engine.values as Record<string, unknown>) })
  )

  const set = (name: string, value: unknown) =>
    setValues(prev => ({ ...prev, [name]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    engine.submit(values as T)
  }

  // Schema not yet loaded
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

        if (field.type === 'textarea') {
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

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
