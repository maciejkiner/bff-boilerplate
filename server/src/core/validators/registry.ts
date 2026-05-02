export type ValidatorFn = (value: unknown) => string | null | Promise<string | null>

export class ValidatorRegistry {
  private readonly _map = new Map<string, ValidatorFn>()

  register(name: string, fn: ValidatorFn): this {
    this._map.set(name, fn)
    return this
  }

  get(name: string): ValidatorFn | undefined {
    return this._map.get(name)
  }

  has(name: string): boolean {
    return this._map.has(name)
  }

  names(): string[] {
    return Array.from(this._map.keys())
  }
}

export const validators = new ValidatorRegistry()
