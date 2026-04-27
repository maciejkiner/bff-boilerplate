import type { FieldConfig } from '../../core/types.js'

interface Props extends Pick<FieldConfig, 'name' | 'label' | 'placeholder' | 'required'> {
  value: string
  error?: string
  onChange: (value: string) => void
}

export function TextareaField({ name, label, placeholder, required, value, error, onChange }: Props) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}{required && ' *'}</label>
      <textarea
        id={name}
        name={name}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error && <span id={`${name}-error`} className="field-error">{error}</span>}
    </div>
  )
}
