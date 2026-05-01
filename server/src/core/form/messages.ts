export type MessageKey =
  | 'required'
  | 'minLength'
  | 'maxLength'
  | 'email'
  | 'url'
  | 'date'
  | 'dateMin'
  | 'dateMax'
  | 'minValue'
  | 'maxValue'
  | 'unique'

export type MessageParams = Record<string, string | number>

export type MessageResolver = (key: MessageKey, params?: MessageParams) => string

export const defaultMessages: Record<MessageKey, string> = {
  required:  'Required',
  minLength: 'Min {min} characters',
  maxLength: 'Max {max} characters',
  email:     'Invalid email',
  url:       'Invalid URL',
  date:      'Invalid date (expected YYYY-MM-DD)',
  dateMin:   'Date must be on or after {min}',
  dateMax:   'Date must be on or before {max}',
  minValue:  'Min value is {min}',
  maxValue:  'Max value is {max}',
  unique:    '{field} already exists',
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

export function makeResolver(
  fieldMessages?: Partial<Record<MessageKey, string>>,
  formMessages?:  Partial<Record<MessageKey, string>>,
  translate?:     MessageResolver,
): MessageResolver {
  return (key, params) => {
    const override = fieldMessages?.[key] ?? formMessages?.[key]
    if (override) return interpolate(override, params)
    if (translate) return translate(key, params)
    return interpolate(defaultMessages[key] ?? key, params)
  }
}
