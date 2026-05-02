import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { UserModel, type User, type UserInsert } from './model.js'
import { userForm } from './form.js'
import { users } from '../../db/schema.js'

export class UsersResource extends BaseCrud<typeof users, UserInsert, User> {
  readonly model = new UserModel()
  readonly form  = userForm
}
