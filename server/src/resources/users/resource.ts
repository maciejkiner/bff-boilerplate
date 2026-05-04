import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { RolePolicy } from '../../core/auth/index.js'
import { UserModel, type User, type UserInsert } from './model.js'
import { userForm } from './form.js'
import { users } from '../../db/schema.js'

export class UsersResource extends BaseCrud<typeof users, UserInsert, User> {
  readonly model  = new UserModel()
  readonly form   = userForm
  // Only admins can manage users
  protected readonly policy = new RolePolicy(['admin'])
}
