import type { FieldConfig } from '../../core/types.js'

interface Props extends Pick<FieldConfig, 'name' | 'label'> {
  value: boolean
  error?: string
  onChange: (value: boolean) => void
}

export function CheckboxField({ name, label, value, error, onChange }: Props) {
  return (
    <div className="field field--checkbox">
      <input
        id={name}
        name={name}
        type="checkbox"
        checked={value}
        onChange={e => onChange(e.target.checked)}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      <label htmlFor={name}>{label}</label>
      {error && <span id={`${name}-error`} className="field-error">{error}</span>}
    </div>
  )
}
