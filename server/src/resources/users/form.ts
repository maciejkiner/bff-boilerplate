import { defineForm, email, text, select, boolean } from '../../core/form/index.js'
import type { UserInsert } from './model.js'

export const userForm = defineForm<UserInsert>([
  email<UserInsert>('email', {
    label:      'Email',
    required:   true,
    filterable: true,
    sortable:   true,
    unique:     { field: 'email', table: 'users', column: 'email' },
  }),
  text<UserInsert>('name', {
    label:      'Full name',
    required:   true,
    maxLength:  100,
    filterable: true,
    sortable:   true,
  }),
  select<UserInsert>('role', {
    label:    'Role',
    required: true,
    options: [
      { value: 'admin', label: 'Admin' },
      { value: 'manager', label: 'Manager' },
      { value: 'user',  label: 'User'  },
    ],
    filterable: true,
  }),
  boolean<UserInsert>('active', {
    label:        'Active',
    defaultValue: true,
    filterable:   true,
  }),
])
