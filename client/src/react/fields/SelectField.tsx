import type { FieldConfig } from '../../core/types.js'

interface Props extends Pick<FieldConfig, 'name' | 'label' | 'required' | 'options'> {
  value: string
  error?: string
  onChange: (value: string) => void
}

export function SelectField({ name, label, required, options = [], value, error, onChange }: Props) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}{required && ' *'}</label>
      <select
        id={name}
        name={name}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      >
        <option value="">— select —</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <span id={`${name}-error`} className="field-error">{error}</span>}
    </div>
  )
}
