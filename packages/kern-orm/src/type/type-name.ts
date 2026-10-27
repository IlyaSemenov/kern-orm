/** Appends type parameters, such as the precision and scale in `numeric(10,2)`, to a type name. */
export function formatTypeName(name: string, ...parameters: (number | undefined)[]): string {
  const defined = parameters.filter(parameter => parameter !== undefined)
  return defined.length === 0 ? name : `${name}(${defined.join(",")})`
}
