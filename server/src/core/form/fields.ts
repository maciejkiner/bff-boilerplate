import type {
  TextFieldDef, EmailFieldDef, UrlFieldDef, TextareaFieldDef,
  NumberFieldDef, BooleanFieldDef, SelectFieldDef,
  DateFieldDef, RichtextFieldDef, RelationFieldDef,
} from './types.js'

type Def<T, D> = Omit<D, 'name' | 'type'>

export const text     = <T>(name: keyof T & string, opts: Def<T, TextFieldDef<T>>):     TextFieldDef<T>     => ({ name, type: 'text',     ...opts })
export const email    = <T>(name: keyof T & string, opts: Def<T, EmailFieldDef<T>>):    EmailFieldDef<T>    => ({ name, type: 'email',    ...opts })
export const url      = <T>(name: keyof T & string, opts: Def<T, UrlFieldDef<T>>):      UrlFieldDef<T>      => ({ name, type: 'url',      ...opts })
export const textarea = <T>(name: keyof T & string, opts: Def<T, TextareaFieldDef<T>>): TextareaFieldDef<T> => ({ name, type: 'textarea', ...opts })
export const number   = <T>(name: keyof T & string, opts: Def<T, NumberFieldDef<T>>):   NumberFieldDef<T>   => ({ name, type: 'number',   ...opts })
export const boolean  = <T>(name: keyof T & string, opts: Def<T, BooleanFieldDef<T>>):  BooleanFieldDef<T>  => ({ name, type: 'boolean',  ...opts })
export const select   = <T>(name: keyof T & string, opts: Def<T, SelectFieldDef<T>>):   SelectFieldDef<T>   => ({ name, type: 'select',   ...opts })
export const date     = <T>(name: keyof T & string, opts: Def<T, DateFieldDef<T>>):     DateFieldDef<T>     => ({ name, type: 'date',     ...opts })
export const richtext = <T>(name: keyof T & string, opts: Def<T, RichtextFieldDef<T>>): RichtextFieldDef<T> => ({ name, type: 'richtext', ...opts })
export const relation = <T>(name: keyof T & string, opts: Def<T, RelationFieldDef<T>>): RelationFieldDef<T> => ({ name, type: 'relation', ...opts })
